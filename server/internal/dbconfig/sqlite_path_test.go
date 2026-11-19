package dbconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeSQLitePath(t *testing.T) {
	got, err := NormalizeSQLitePath("/tmp/atolla.db")
	if err != nil || got != "/tmp/atolla.db" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	if _, err := NormalizeSQLitePath("relative.db"); err == nil {
		t.Fatal("relative should fail")
	}
	if _, err := NormalizeSQLitePath("/tmp/atolla.sqlite"); err == nil {
		t.Fatal("non-.db should fail")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	got, err = NormalizeSQLitePath("~/data/atolla.db")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "data", "atolla.db")
	if got != want {
		t.Fatalf("got=%q want=%q", got, want)
	}
}

func TestWriteSQLitePath(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "shared", "team.db")
	if err := WriteSQLitePath(root, target); err != nil {
		t.Fatal(err)
	}
	m, err := ReadEnvFile(EnvPath(root))
	if err != nil {
		t.Fatal(err)
	}
	if m[EnvDriver] != DriverSQLite || m[EnvDSN] != target || m[EnvChosen] != "1" {
		t.Fatalf("env=%v", m)
	}
}

func TestEffectiveSQLitePath(t *testing.T) {
	root := "/repo"
	if EffectiveSQLitePath(root, "mysql", "x") != SQLiteDSN(root) {
		t.Fatal("mysql should fall back to default display path")
	}
	custom := "/data/custom.db"
	if EffectiveSQLitePath(root, "sqlite", custom) != custom {
		t.Fatal("should use custom dsn")
	}
}
