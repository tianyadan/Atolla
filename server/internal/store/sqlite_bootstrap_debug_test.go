package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestDebugSQLiteBootstrap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "x.db")
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for i, stmt := range splitSQLStatements(sqliteSchemaSQL) {
		if _, err := db.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("stmt #%d err=%v\n---\n%s\n---", i, err, stmt)
		}
	}
}
