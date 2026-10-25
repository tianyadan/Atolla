package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrateProjectsDirCopiesMissingOnly(t *testing.T) {
	oldRoot := t.TempDir()
	newRoot := t.TempDir()
	srcProj := filepath.Join(oldRoot, "projects", "demo")
	if err := os.MkdirAll(srcProj, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcProj, "summary.md"), []byte("# hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 目标已有同名目录，应跳过
	exist := filepath.Join(newRoot, "projects", "keep")
	if err := os.MkdirAll(exist, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(exist, "summary.md"), []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldKeep := filepath.Join(oldRoot, "projects", "keep")
	if err := os.MkdirAll(oldKeep, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(oldKeep, "summary.md"), []byte("new\n"), 0o644)

	n := migrateProjectsDir(oldRoot, newRoot)
	if n != 1 {
		t.Fatalf("migrated=%d want 1", n)
	}
	got, err := os.ReadFile(filepath.Join(newRoot, "projects", "demo", "summary.md"))
	if err != nil || string(got) != "# hi\n" {
		t.Fatalf("demo summary: %q err=%v", got, err)
	}
	keep, err := os.ReadFile(filepath.Join(newRoot, "projects", "keep", "summary.md"))
	if err != nil || string(keep) != "old\n" {
		t.Fatalf("keep should not overwrite: %q", keep)
	}
}

func TestWorkspaceChangeNote(t *testing.T) {
	msg := workspaceChangeNote("/a", "/b", 2)
	for _, part := range []string{"工作区", "/a", "/b", "2"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("missing %q in note: %s", part, msg)
		}
	}
}
