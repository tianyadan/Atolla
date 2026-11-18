package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEngineSupportsLocalImageAttach(t *testing.T) {
	if !EngineSupportsLocalImageAttach("codex") {
		t.Fatal("codex should support")
	}
	if !EngineSupportsLocalImageAttach("agent") {
		t.Fatal("cursor/agent should support")
	}
	if EngineSupportsLocalImageAttach("claude") {
		t.Fatal("claude must skip")
	}
}

func TestExtractLocalImagePathCandidates(t *testing.T) {
	text := "找到了 `/Users/me/Desktop/a.png` 和 file:///Users/me/Pictures/b.JPEG，还有重复 /Users/me/Desktop/a.png"
	got := ExtractLocalImagePathCandidates(text)
	if len(got) != 2 {
		t.Fatalf("want 2 unique paths, got %#v", got)
	}
}

func TestPathAllowedForLocalImage(t *testing.T) {
	home := "/Users/me"
	ws := "/Users/me/ws"
	if !pathAllowedForLocalImage("/Users/me/Desktop/x.png", home, ws) {
		t.Fatal("desktop should allow")
	}
	if !pathAllowedForLocalImage("/Users/me/ws/out/shot.webp", home, ws) {
		t.Fatal("workspace should allow")
	}
	if pathAllowedForLocalImage("/Users/me/.ssh/id_rsa.png", home, ws) {
		t.Fatal(".ssh must deny")
	}
	if pathAllowedForLocalImage("/Users/me/Library/Keychains/foo.png", home, ws) {
		t.Fatal("Keychains must deny")
	}
	if pathAllowedForLocalImage("/tmp/evil.png", home, ws) {
		t.Fatal("outside home/ws must deny")
	}
}

func TestResolveLocalImagePaths(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	ws := filepath.Join(root, "ws")
	_ = os.MkdirAll(filepath.Join(home, "Desktop"), 0o755)
	_ = os.MkdirAll(ws, 0o755)
	okPath := filepath.Join(home, "Desktop", "shot.png")
	if err := os.WriteFile(okPath, []byte("png-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	denyPath := filepath.Join(home, ".ssh", "x.png")
	_ = os.MkdirAll(filepath.Dir(denyPath), 0o755)
	_ = os.WriteFile(denyPath, []byte("x"), 0o644)
	missing := filepath.Join(home, "Desktop", "gone.png")

	want, _ := filepath.EvalSymlinks(okPath)
	if want == "" {
		want = okPath
	}
	got := ResolveLocalImagePaths([]string{okPath, denyPath, missing, okPath}, home, ws, 6)
	if len(got) != 1 || got[0] != want {
		t.Fatalf("want only %q, got %#v", want, got)
	}
}
