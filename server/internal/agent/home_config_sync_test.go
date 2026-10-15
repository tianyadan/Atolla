package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMergeCursorSandboxPreservesOtherKeys(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sandbox.json")
	if err := os.WriteFile(path, []byte(`{"type":"workspace_readwrite","networkPolicy":{"default":"deny","allow":["a.com"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := mergeCursorSandbox(path, []string{"b.com", "a.com"}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	var root map[string]any
	if err := json.Unmarshal(b, &root); err != nil {
		t.Fatal(err)
	}
	if root["type"] != "workspace_readwrite" {
		t.Fatalf("lost type: %v", root["type"])
	}
	np := root["networkPolicy"].(map[string]any)
	if np["default"] != "allow" {
		t.Fatalf("want default allow, got %v", np["default"])
	}
	allow := stringSlice(np["allow"])
	if len(allow) != 2 {
		t.Fatalf("allow=%v", allow)
	}
}

func TestMergeClaudeSettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := mergeClaudeSettings(path, []string{"restapi.amap.com"}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	var root map[string]any
	_ = json.Unmarshal(b, &root)
	sb := root["sandbox"].(map[string]any)
	if sb["enabled"] != false {
		t.Fatal("expected sandbox.enabled false (relaxed egress)")
	}
	net := sb["network"].(map[string]any)
	dom := stringSlice(net["allowedDomains"])
	if len(dom) != 1 || dom[0] != "restapi.amap.com" {
		t.Fatalf("domains=%v", dom)
	}
}

func TestMergeCodexConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("model = \"x\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := mergeCodexConfig(path, true); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	s := string(b)
	if !strings.Contains(s, "model = \"x\"") {
		t.Fatal("lost model")
	}
	if !strings.Contains(s, "network_access = true") {
		t.Fatal("missing network_access")
	}
	if err := mergeCodexConfig(path, false); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(path)
	if !strings.Contains(string(b), "network_access = false") {
		t.Fatal("expected false")
	}
}
