package service

import (
	"os"
	"path/filepath"
	"testing"

	"atolla/server/config"
)

func TestResolveWatchdogScript(t *testing.T) {
	root := t.TempDir()
	rel := filepath.Join("scripts", "watchdog", "status-local.sh")
	full := filepath.Join(root, "colleague-avatar", rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("#!/bin/sh\necho ok\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := &Service{Cfg: config.Config{WorkspaceRoot: root}}
	got, err := s.resolveWatchdogScript(rel)
	if err != nil {
		t.Fatal(err)
	}
	if got != full {
		t.Fatalf("got %s want %s", got, full)
	}
}

func TestLastJSONLine(t *testing.T) {
	out := "==> hello\n{\"enabled\":true,\"status\":\"active\"}\n"
	got := lastJSONLine(out)
	if got != `{"enabled":true,"status":"active"}` {
		t.Fatalf("got %q", got)
	}
}

func TestRelayWatchdogTargetPersist(t *testing.T) {
	root := t.TempDir()
	s := &Service{Cfg: config.Config{WorkspaceRoot: root}}
	in := RelayWatchdogTarget{Host: "1.2.3.4", User: "root", SSHPort: 22, RemoteDir: "/opt/x", ListenPort: 3080}
	if err := s.saveRelayWatchdogTarget(in); err != nil {
		t.Fatal(err)
	}
	out, ok := s.loadRelayWatchdogTarget()
	if !ok {
		t.Fatal("expected ok")
	}
	if out.Host != in.Host || out.RemoteDir != in.RemoteDir {
		t.Fatalf("mismatch %+v", out)
	}
}
