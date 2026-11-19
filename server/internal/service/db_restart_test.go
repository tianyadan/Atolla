package service

import (
	"testing"
)

func TestApplyConfigRestartDesktopSkipsScript(t *testing.T) {
	t.Setenv("AVATAR_DESKTOP", "1")
	t.Setenv("AVATAR_RUNTIME_ROOT", "")
	res := applyConfigRestart("/tmp/not-a-repo", "sqlite")
	if res.Restart != "desktop" {
		t.Fatalf("restart=%q want desktop", res.Restart)
	}
	if res.Command != "" {
		t.Fatalf("command should be empty for desktop, got %q", res.Command)
	}
}

func TestApplyConfigRestartWebManualWithoutScript(t *testing.T) {
	t.Setenv("AVATAR_DESKTOP", "")
	t.Setenv("AVATAR_RUNTIME_ROOT", "")
	res := applyConfigRestart("/tmp/not-a-repo", "sqlite")
	if res.Restart != "manual" {
		t.Fatalf("restart=%q want manual when restart.sh missing", res.Restart)
	}
	if res.Command != "./scripts/restart.sh" {
		t.Fatalf("command=%q", res.Command)
	}
}

func TestIsDesktopApp(t *testing.T) {
	t.Setenv("AVATAR_DESKTOP", "")
	t.Setenv("AVATAR_RUNTIME_ROOT", "")
	if isDesktopApp() {
		t.Fatal("expected false")
	}
	t.Setenv("AVATAR_RUNTIME_ROOT", "/tmp/atolla-runtime")
	if !isDesktopApp() {
		t.Fatal("runtime root should mark desktop")
	}
}
