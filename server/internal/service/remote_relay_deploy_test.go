package service

import (
	"os"
	"path/filepath"
	"testing"

	"atolla/server/config"
)

func TestResolveRemoteRelayDeployScript(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "remote-relay", "deploy", "install.sh")
	if err := os.MkdirAll(filepath.Dir(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho ok\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := &Service{Cfg: config.Config{WorkspaceRoot: root}}
	got, repo, err := s.resolveRemoteRelayDeployScript("install.sh")
	if err != nil {
		t.Fatal(err)
	}
	if got != script {
		t.Fatalf("script=%s want %s", got, script)
	}
	if repo != root {
		t.Fatalf("repo=%s want %s", repo, root)
	}
}

func TestStartDeployRejectsEmptyHost(t *testing.T) {
	s := &Service{Cfg: config.Config{WorkspaceRoot: t.TempDir()}}
	_, err := s.StartRemoteRelayDeploy(RemoteRelayDeployRequest{SitePassword: "x"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNormalizeSSHPassword(t *testing.T) {
	if got := normalizeSSHPassword("  p@ss\r  "); got != "p@ss" {
		t.Fatalf("got %q want p@ss", got)
	}
}
