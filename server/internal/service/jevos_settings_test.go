package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseGitHubReleaseDownloadURL(t *testing.T) {
	tag, asset, ok := parseGitHubReleaseDownloadURL(
		"https://github.com/feder-cr/jev/releases/download/jevos-v5/jev-macos-arm64.tar.gz",
	)
	if !ok || tag != "jevos-v5" || asset != "jev-macos-arm64.tar.gz" {
		t.Fatalf("got ok=%v tag=%q asset=%q", ok, tag, asset)
	}
	mirrors := jevosReleaseMirrorURLs("https://github.com/feder-cr/jev/releases/download/jevos-v5/jev-macos-arm64.tar.gz")
	if len(mirrors) < 1 || !strings.Contains(mirrors[0], "https://github.com/feder-cr/jev/") {
		t.Fatalf("mirrors=%v", mirrors)
	}
}

func TestFlattenJevosStagePromotesNestedRuntimeDirectory(t *testing.T) {
	stage := t.TempDir()
	nestedRuntime := filepath.Join(stage, "jev")
	if err := os.MkdirAll(nestedRuntime, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nestedRuntime, "jev"), []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nestedRuntime, "libopenvino.dylib"), []byte("library"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := flattenJevosStage(stage); err != nil {
		t.Fatalf("flattenJevosStage returned error: %v", err)
	}

	binInfo, err := os.Stat(filepath.Join(stage, "jev"))
	if err != nil {
		t.Fatal(err)
	}
	if binInfo.IsDir() {
		t.Fatal("expected stage/jev to be the executable, not a directory")
	}
	if _, err := os.Stat(filepath.Join(stage, "libopenvino.dylib")); err != nil {
		t.Fatalf("expected runtime library at stage root: %v", err)
	}
}

func TestFlattenJevosModelDirectoryPromotesNestedModelFiles(t *testing.T) {
	modelDir := filepath.Join(t.TempDir(), "model")
	nestedModelDir := filepath.Join(modelDir, "model")
	if err := os.MkdirAll(nestedModelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nestedModelDir, "openvino_model.bin"), []byte("model"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nestedModelDir, "model.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	changed, err := flattenJevosModelDirectory(modelDir)
	if err != nil {
		t.Fatalf("flattenJevosModelDirectory returned error: %v", err)
	}
	if !changed {
		t.Fatal("expected nested model directory to be normalized")
	}
	if _, err := os.Stat(filepath.Join(modelDir, "openvino_model.bin")); err != nil {
		t.Fatalf("expected model artifact at model root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(modelDir, "model.json")); err != nil {
		t.Fatalf("expected model manifest at model root: %v", err)
	}
}
