package store

import (
	"context"
	_ "embed"
	"strings"
)

//go:embed schema.sqlite.sql
var sqliteSchemaSQL string

// bootstrapSQLite 空库时灌入完整 SQLite schema。
func (s *Store) bootstrapSQLite(ctx context.Context) error {
	if !s.IsSQLite() {
		return nil
	}
	ok, err := s.hasTable(ctx, "managed_agents")
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	for _, stmt := range splitSQLStatements(sqliteSchemaSQL) {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func splitSQLStatements(sqlText string) []string {
	var out []string
	var b strings.Builder
	for _, line := range strings.Split(sqlText, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "--") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
		if strings.HasSuffix(trim, ";") {
			stmt := strings.TrimSpace(b.String())
			b.Reset()
			if stmt != "" && stmt != ";" {
				out = append(out, stmt)
			}
		}
	}
	if rest := strings.TrimSpace(b.String()); rest != "" {
		out = append(out, rest)
	}
	return out
}
