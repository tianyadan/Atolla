package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSettingsIncludesUnsandboxedEscape(t *testing.T) {
	s := HookSpec{Bin: "/tmp/avatar-hook", TimeoutS: 10}.Settings()
	if s == "" {
		t.Fatal("empty settings")
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatal(err)
	}
	sb, ok := m["sandbox"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing sandbox: %s", s)
	}
	if sb["allowUnsandboxedCommands"] != true {
		t.Fatalf("allowUnsandboxedCommands=%v", sb["allowUnsandboxedCommands"])
	}
	if !strings.Contains(s, "PreToolUse") {
		t.Fatal("hooks missing")
	}
}

func TestCLIChildEnvDisablesAutomaticUpdates(t *testing.T) {
	claude := strings.Join(CLIChildEnv(nil, "claude"), "\n")
	if !strings.Contains(claude, "DISABLE_AUTOUPDATER=1") || !strings.Contains(claude, "DISABLE_UPDATES=1") {
		t.Fatalf("claude update guard missing: %s", claude)
	}
	codex := strings.Join(CodexArgs("", "hello", true, "workspace-write", ""), " ")
	if !strings.Contains(codex, "check_for_update_on_startup=false") {
		t.Fatalf("codex update guard missing: %s", codex)
	}
	cursor := strings.Join(CLIChildEnv(nil, "cursor"), "\n")
	if !strings.Contains(cursor, "CURSOR_AGENT_DISABLE_UPDATE=1") {
		t.Fatalf("cursor update guard missing: %s", cursor)
	}
}
