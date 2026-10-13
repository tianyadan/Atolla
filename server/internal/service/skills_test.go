package service

import (
	"testing"

	"atolla/server/internal/store"
)

func TestFormatInstalledSkillsPromptUsedByService(t *testing.T) {
	block := store.FormatInstalledSkillsPrompt([]store.AgentSkillView{{
		ID: "atolla.coding", Name: "代码读写", Summary: "读写",
		Capabilities: []string{"engine.write"},
		Rules:        []store.SkillRule{{Type: "deny", Text: "不得越界"}},
	}})
	if block == "" {
		t.Fatal("empty block")
	}
	if !contains(block, "## Skills") || !contains(block, "不得越界") {
		t.Fatalf("unexpected: %s", block)
	}
}

func TestSyncEngineFlagsFromSkills(t *testing.T) {
	a := &store.ManagedAgent{AllowWrite: false, AllowNetwork: false, AllowBrowser: false}
	store.SyncEngineFlagsFromSkills([]store.AgentSkillView{
		{ID: "atolla.coding", Installed: true, Enabled: true, Capabilities: []string{"engine.write"}},
		{ID: "atolla.search", Installed: true, Enabled: true, Capabilities: []string{"engine.web_search"}},
		{ID: "atolla.browser", Installed: true, Enabled: true, Capabilities: []string{"engine.browser"}},
	}, a)
	if !a.AllowWrite || !a.AllowNetwork || !a.AllowBrowser {
		t.Fatalf("flags not synced: %+v", a)
	}
	a2 := &store.ManagedAgent{AllowWrite: true, AllowBrowser: true}
	store.SyncEngineFlagsFromSkills([]store.AgentSkillView{
		{ID: "atolla.coding", Installed: true, Enabled: true, Capabilities: []string{"engine.read"}},
	}, a2)
	if a2.AllowWrite {
		t.Fatal("write should be off without engine.write")
	}
	if a2.AllowBrowser {
		t.Fatal("browser should be off when browser skill not installed")
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || (len(sub) > 0 && indexOf(s, sub) >= 0))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
