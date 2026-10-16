package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLocalAvatarPathTalentFile(t *testing.T) {
	dir := t.TempDir()
	pub := filepath.Join(dir, "web", "public", "talent-avatars")
	if err := os.MkdirAll(pub, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(pub, "a.jpg")
	if err := os.WriteFile(file, []byte("jpg"), 0o644); err != nil {
		t.Fatal(err)
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })
	got := localAvatarPath("/talent-avatars/a.jpg")
	sa, err1 := os.Stat(got)
	sb, err2 := os.Stat(file)
	if err1 != nil || err2 != nil || !os.SameFile(sa, sb) {
		t.Fatalf("got %q want same file as %q", got, file)
	}
	if localAvatarPath("/talent-avatars/../../etc/passwd") != "" {
		t.Fatal("path traversal must be rejected")
	}
}
