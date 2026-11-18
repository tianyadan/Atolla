package dbmigrate

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// Progress 迁库进度快照。
type Progress struct {
	Phase   string  `json:"phase"` // idle|preparing|copying|done|error
	Table   string  `json:"table,omitempty"`
	Percent float64 `json:"percent"`
	Error   string  `json:"error,omitempty"`
	From    string  `json:"from,omitempty"`
	To      string  `json:"to,omitempty"`
}

var (
	progMu sync.Mutex
	prog   = Progress{Phase: "idle"}
)

// Current 返回当前进度副本。
func Current() Progress {
	progMu.Lock()
	defer progMu.Unlock()
	return prog
}

func setProgress(p Progress) {
	progMu.Lock()
	prog = p
	progMu.Unlock()
}

// CopyAll 将 src 全部用户表拷到 dst（先清空目标表）。调用方需保证 dst 已 Migrate。
func CopyAll(ctx context.Context, src, dst *sql.DB, srcDriver, dstDriver, fromLabel, toLabel string) error {
	setProgress(Progress{Phase: "preparing", Percent: 0, From: fromLabel, To: toLabel})
	tables, err := listTables(ctx, src, srcDriver)
	if err != nil {
		setProgress(Progress{Phase: "error", Error: err.Error(), From: fromLabel, To: toLabel})
		return err
	}
	dstTables, err := listTables(ctx, dst, dstDriver)
	if err != nil {
		setProgress(Progress{Phase: "error", Error: err.Error(), From: fromLabel, To: toLabel})
		return err
	}
	dstSet := map[string]bool{}
	for _, t := range dstTables {
		dstSet[strings.ToLower(t)] = true
	}
	var todo []string
	for _, t := range tables {
		if skipTable(t) {
			continue
		}
		if !dstSet[strings.ToLower(t)] {
			continue
		}
		todo = append(todo, t)
	}
	sort.Strings(todo)

	if err := setFK(ctx, src, srcDriver, false); err != nil {
		setProgress(Progress{Phase: "error", Error: err.Error(), From: fromLabel, To: toLabel})
		return err
	}
	if err := setFK(ctx, dst, dstDriver, false); err != nil {
		setProgress(Progress{Phase: "error", Error: err.Error(), From: fromLabel, To: toLabel})
		return err
	}
	defer func() {
		_ = setFK(context.Background(), src, srcDriver, true)
		_ = setFK(context.Background(), dst, dstDriver, true)
	}()

	n := len(todo)
	if n == 0 {
		setProgress(Progress{Phase: "done", Percent: 100, From: fromLabel, To: toLabel})
		return nil
	}
	for i, table := range todo {
		if err := ctx.Err(); err != nil {
			setProgress(Progress{Phase: "error", Error: err.Error(), Table: table, From: fromLabel, To: toLabel})
			return err
		}
		pct := float64(i) / float64(n) * 100
		setProgress(Progress{Phase: "copying", Table: table, Percent: pct, From: fromLabel, To: toLabel})
		if err := copyTable(ctx, src, dst, table); err != nil {
			err = fmt.Errorf("table %s: %w", table, err)
			setProgress(Progress{Phase: "error", Error: err.Error(), Table: table, Percent: pct, From: fromLabel, To: toLabel})
			return err
		}
	}
	setProgress(Progress{Phase: "done", Percent: 100, From: fromLabel, To: toLabel})
	return nil
}

func skipTable(name string) bool {
	n := strings.ToLower(name)
	return strings.HasPrefix(n, "sqlite_") || n == "schema_migrations"
}

func listTables(ctx context.Context, db *sql.DB, driver string) ([]string, error) {
	var q string
	if driver == "sqlite" || driver == "sqlite3" {
		q = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
	} else {
		q = `SHOW TABLES`
	}
	rows, err := db.QueryContext(ctx, q)
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

func setFK(ctx context.Context, db *sql.DB, driver string, on bool) error {
	if driver == "sqlite" || driver == "sqlite3" {
		v := 0
		if on {
			v = 1
		}
		_, err := db.ExecContext(ctx, fmt.Sprintf(`PRAGMA foreign_keys=%d`, v))
		return err
	}
	v := 0
	if on {
		v = 1
	}
	_, err := db.ExecContext(ctx, fmt.Sprintf(`SET FOREIGN_KEY_CHECKS=%d`, v))
	return err
}

func copyTable(ctx context.Context, src, dst *sql.DB, table string) error {
	ident, err := safeIdent(table)
	if err != nil {
		return err
	}
	if _, err := dst.ExecContext(ctx, `DELETE FROM `+ident); err != nil {
		return fmt.Errorf("clear: %w", err)
	}
	rows, err := src.QueryContext(ctx, `SELECT * FROM `+ident)
	if err != nil {
		return fmt.Errorf("select: %w", err)
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}
	colList := make([]string, len(cols))
	placeholders := make([]string, len(cols))
	for i, c := range cols {
		ci, err := safeIdent(c)
		if err != nil {
			return err
		}
		colList[i] = ci
		placeholders[i] = "?"
	}
	insertSQL := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`,
		ident, strings.Join(colList, ","), strings.Join(placeholders, ","))
	stmt, err := dst.PrepareContext(ctx, insertSQL)
	if err != nil {
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()

	raw := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		// MySQL 扫进 interface{} 的字符串是 []byte；原样写入 SQLite 会变成 BLOB，
		// 导致 role='user' 等文本比较失败、标题回退成 LEFT(NULL)→"<nil>"。
		vals := make([]any, len(raw))
		for i, v := range raw {
			vals[i] = normalizeCopyValue(v)
		}
		if _, err := stmt.ExecContext(ctx, vals...); err != nil {
			return fmt.Errorf("insert: %w", err)
		}
	}
	return rows.Err()
}

/** normalizeCopyValue：[]byte 当文本写入（TEXT），避免 SQLite 存成 BLOB。 */
func normalizeCopyValue(v any) any {
	switch t := v.(type) {
	case nil:
		return nil
	case []byte:
		if t == nil {
			return nil
		}
		return string(t)
	default:
		return v
	}
}

// safeIdent 仅允许字母数字下划线，避免注入。
func safeIdent(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("empty identifier")
	}
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return "", fmt.Errorf("unsafe identifier %q", name)
	}
	return name, nil
}
