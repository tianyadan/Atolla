package dbmigrate

import (
	"context"
	"path/filepath"
	"testing"

	"atolla/server/internal/store"
)

func TestNormalizeCopyValueBytesBecomeString(t *testing.T) {
	got := normalizeCopyValue([]byte("user"))
	s, ok := got.(string)
	if !ok || s != "user" {
		t.Fatalf("got %#v", got)
	}
	if normalizeCopyValue(nil) != nil {
		t.Fatal("nil should stay nil")
	}
}

func TestCopySQLiteToSQLite(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "src.db")
	dstPath := filepath.Join(dir, "dst.db")
	src, err := store.NewWithDriver(store.DriverSQLite, srcPath)
	if err != nil {
		t.Fatal(err)
	}
	defer src.SQLDB().Close()
	ctx := context.Background()
	_, err = src.CreateManagedAgent(ctx, store.ManagedAgentInput{Name: "mig-a", Engine: "claude"})
	if err != nil {
		t.Fatal(err)
	}
	dst, err := store.NewWithDriver(store.DriverSQLite, dstPath)
	if err != nil {
		t.Fatal(err)
	}
	defer dst.SQLDB().Close()
	if err := CopyAll(ctx, src.SQLDB(), dst.SQLDB(), store.DriverSQLite, store.DriverSQLite, "sqlite", "sqlite"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := dst.SQLDB().QueryRow(`SELECT COUNT(*) FROM managed_agents WHERE name=?`, "mig-a").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 agent, got %d", n)
	}
	p := Current()
	if p.Phase != "done" || p.Percent != 100 {
		t.Fatalf("progress=%+v", p)
	}
}
