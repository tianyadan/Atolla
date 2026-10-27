package store

import (
	"context"
	"fmt"
	"strings"
)

// repairSQLiteTextAffinity 把误存为 BLOB 的文本列 CAST 回 TEXT。
// go-sql-driver/mysql 扫入 interface{} 得到 []byte，迁库原样写入 SQLite 会变成 BLOB，
// 导致 role='user' 匹配不到、对话标题回退 LEFT(NULL) 显示成 "<nil>"。
//
// 若同一唯一键既有 TEXT 又有同内容 BLOB（迁库重复写入），直接 CAST 会触发 UNIQUE；
// 单列主键/UNIQUE 先去掉会撞车的 BLOB 行（保留 TEXT），再 CAST。
func (s *Store) repairSQLiteTextAffinity(ctx context.Context) error {
	if !s.IsSQLite() {
		return nil
	}
	tables, err := s.listUserTables(ctx)
	if err != nil {
		return err
	}
	for _, table := range tables {
		if !safeSQLIdent(table) {
			continue
		}
		cols, err := s.listTableColumns(ctx, table)
		if err != nil {
			return err
		}
		uniqCols, err := s.listSingleColumnUniques(ctx, table, cols)
		if err != nil {
			return err
		}
		for _, uc := range uniqCols {
			if err := s.dedupeSQLiteBlobUnique(ctx, table, uc); err != nil {
				return fmt.Errorf("dedupe %s.%s: %w", table, uc, err)
			}
		}
		for _, col := range cols {
			if isDeclaredBlobType(col.declType) || !safeSQLIdent(col.name) {
				continue
			}
			identT := quoteIdent(table)
			identC := quoteIdent(col.name)
			q := fmt.Sprintf(
				`UPDATE %s SET %s=CAST(%s AS TEXT) WHERE typeof(%s)='blob'`,
				identT, identC, identC, identC,
			)
			if _, err := s.db.ExecContext(ctx, q); err != nil {
				return fmt.Errorf("repair %s.%s: %w", table, col.name, err)
			}
		}
	}
	return nil
}

// listSingleColumnUniques 收集单列主键与单列 UNIQUE 索引列名。
func (s *Store) listSingleColumnUniques(ctx context.Context, table string, cols []sqliteCol) ([]string, error) {
	seen := map[string]struct{}{}
	var out []string
	add := func(name string) {
		if !safeSQLIdent(name) {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	if pk := singleColumnPK(cols); pk != "" {
		add(pk)
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA index_list(`+quoteIdent(table)+`)`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	type idxMeta struct {
		name string
		uniq int
	}
	var idxs []idxMeta
	for rows.Next() {
		var seq int
		var name string
		var unique, origin, partial any
		// seq, name, unique, origin, partial
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return out, err
		}
		u := 0
		switch v := unique.(type) {
		case int64:
			u = int(v)
		case bool:
			if v {
				u = 1
			}
		}
		if u != 0 {
			idxs = append(idxs, idxMeta{name: name, uniq: u})
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	for _, idx := range idxs {
		if !safeSQLIdent(idx.name) {
			continue
		}
		infoRows, err := s.db.QueryContext(ctx, `PRAGMA index_info(`+quoteIdent(idx.name)+`)`)
		if err != nil {
			return out, err
		}
		var colNames []string
		for infoRows.Next() {
			var seqno, cid int
			var colName string
			if err := infoRows.Scan(&seqno, &cid, &colName); err != nil {
				infoRows.Close()
				return out, err
			}
			colNames = append(colNames, colName)
		}
		err = infoRows.Err()
		infoRows.Close()
		if err != nil {
			return out, err
		}
		if len(colNames) == 1 {
			add(colNames[0])
		}
	}
	return out, nil
}

// singleColumnPK 返回单列主键名；复合主键返回空。
func singleColumnPK(cols []sqliteCol) string {
	var pk string
	n := 0
	for _, c := range cols {
		if c.pk > 0 {
			n++
			pk = c.name
		}
	}
	if n != 1 {
		return ""
	}
	return pk
}

// dedupeSQLiteBlobUnique 删除会与 TEXT 唯一键撞车的 BLOB 行；仅 BLOB 重复时保留最小 rowid。
func (s *Store) dedupeSQLiteBlobUnique(ctx context.Context, table, col string) error {
	identT := quoteIdent(table)
	identC := quoteIdent(col)
	// 1) 已有 TEXT 同键 → 删 BLOB 副本
	q1 := fmt.Sprintf(`
		DELETE FROM %s
		WHERE typeof(%s)='blob'
		  AND EXISTS (
		    SELECT 1 FROM %s AS t2
		    WHERE typeof(t2.%s)='text'
		      AND CAST(t2.%s AS TEXT)=CAST(%s.%s AS TEXT)
		      AND t2.rowid<>%s.rowid
		  )`, identT, identC, identT, identC, identC, identT, identC, identT)
	if _, err := s.db.ExecContext(ctx, q1); err != nil {
		return err
	}
	// 2) 仅剩多行 BLOB 同键 → 保留最小 rowid
	q2 := fmt.Sprintf(`
		DELETE FROM %s
		WHERE typeof(%s)='blob'
		  AND EXISTS (
		    SELECT 1 FROM %s AS t2
		    WHERE typeof(t2.%s)='blob'
		      AND CAST(t2.%s AS TEXT)=CAST(%s.%s AS TEXT)
		      AND t2.rowid<%s.rowid
		  )`, identT, identC, identT, identC, identC, identT, identC, identT)
	_, err := s.db.ExecContext(ctx, q2)
	return err
}

type sqliteCol struct {
	name     string
	declType string
	pk       int
}

func (s *Store) listUserTables(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (s *Store) listTableColumns(ctx context.Context, table string) ([]sqliteCol, error) {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(`+quoteIdent(table)+`)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sqliteCol
	for rows.Next() {
		var cid int
		var name, decl string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &decl, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		out = append(out, sqliteCol{name: name, declType: decl, pk: pk})
	}
	return out, rows.Err()
}

func isDeclaredBlobType(decl string) bool {
	u := strings.ToUpper(strings.TrimSpace(decl))
	return u == "BLOB" || strings.HasPrefix(u, "BLOB(")
}

func safeSQLIdent(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return false
	}
	return true
}
