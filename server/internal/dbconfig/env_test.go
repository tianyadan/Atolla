package dbconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUpsertEnvKeys(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := os.WriteFile(p, []byte("FOO=1\n# c\nBAR=2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := UpsertEnvKeys(p, map[string]string{
		"BAR":             "9",
		"AVATAR_DB_DRIVER": "sqlite",
	}); err != nil {
		t.Fatal(err)
	}
	m, err := ReadEnvFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if m["FOO"] != "1" || m["BAR"] != "9" || m["AVATAR_DB_DRIVER"] != "sqlite" {
		t.Fatalf("%v", m)
	}
}

func TestWriteDriverChoiceSQLite(t *testing.T) {
	root := t.TempDir()
	if err := WriteDriverChoice(root, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if !Chosen(root) {
		t.Fatal("expected chosen")
	}
	m, _ := ReadEnvFile(EnvPath(root))
	if m[EnvDriver] != DriverSQLite {
		t.Fatalf("driver=%s", m[EnvDriver])
	}
	if m[EnvDSN] != SQLiteDSN(root) {
		t.Fatalf("dsn=%s", m[EnvDSN])
	}
}

func TestRepoRootUsesDesktopRuntimeRoot(t *testing.T) {
	runtimeRoot := t.TempDir()
	t.Setenv(EnvRuntimeRoot, runtimeRoot)

	root, err := RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	if root != runtimeRoot {
		t.Fatalf("root=%q, want %q", root, runtimeRoot)
	}
}
