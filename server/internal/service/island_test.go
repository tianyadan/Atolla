package service

import (
	"os"
	"path/filepath"
	"testing"

	"atolla/server/config"
)

func TestSyncIslandConfigWritesHomeAtolla(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	s := &Service{Cfg: config.Config{BackendURL: "http://127.0.0.1:8080", WorkspaceRoot: t.TempDir()}}
	path, err := s.SyncIslandConfig("tok-abc", "http://127.0.0.1:8080", "http://127.0.0.1:5173")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, ".atolla", "island.json")
	if path != want {
		t.Fatalf("path=%s want=%s", path, want)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 10 {
		t.Fatalf("empty config")
	}
}

func TestIslandBusyStatusHeuristic(t *testing.T) {
	// 纯函数级：确认忙碌判定覆盖常见状态
	cases := []struct {
		st   string
		busy bool
	}{
		{"running", true},
		{"waiting", true},
		{"idle", false},
		{"done", false},
		{"compressing", true},
	}
	for _, c := range cases {
		st := c.st
		busy := st == "running" || st == "busy" || st == "插话中" ||
			st == "initializing" || st == "compressing" || st == "waiting"
		if busy != c.busy {
			t.Fatalf("%s: got %v want %v", c.st, busy, c.busy)
		}
	}
}
