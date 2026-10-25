package service

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"atolla/server/config"
)

func TestResolveIslandScript(t *testing.T) {
	root := t.TempDir()
	rel := filepath.Join("macos", "AtollaIsland", "scripts", "status-island.sh")
	full := filepath.Join(root, "colleague-avatar", rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("#!/bin/sh\necho '{}'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := &Service{Cfg: config.Config{WorkspaceRoot: root}}
	got, err := s.resolveIslandScript("scripts/status-island.sh")
	if err != nil {
		t.Fatal(err)
	}
	if got != full {
		t.Fatalf("got %s want %s", got, full)
	}
}

func TestIslandSettingsCacheRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	s := &Service{Cfg: config.Config{WorkspaceRoot: t.TempDir()}}
	in := IslandSettingsStatus{
		Installed: true,
		Enabled:   true,
		Detail:    "ok",
		CheckedAt: "2026-10-22T12:00:00+08:00",
	}
	if err := s.saveIslandSettingsCache(in); err != nil {
		t.Fatal(err)
	}
	out, ok := s.loadIslandSettingsCache()
	if !ok {
		t.Fatal("expected cache")
	}
	if !out.Installed || !out.Enabled || out.Detail != "ok" {
		t.Fatalf("%+v", out)
	}
}

func TestShortIslandErr(t *testing.T) {
	got := shortIslandErr(fmt.Errorf("第一行\n第二行很长很长"))
	if got != "第一行" {
		t.Fatalf("got %q", got)
	}
}

func TestPickIslandAsset(t *testing.T) {
	a, ok := pickIslandAsset([]githubReleaseAsset{
		{Name: "Source.zip", BrowserDownloadURL: "x"},
		{Name: "AtollaIsland-macos-arm64-20261024-repack-bundle.zip", BrowserDownloadURL: "y"},
	}, "AtollaIsland-macos-arm64-")
	if !ok || a.BrowserDownloadURL != "y" {
		t.Fatalf("%v %v", ok, a)
	}
}
