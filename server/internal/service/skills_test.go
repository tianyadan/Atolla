package service

import (
	"testing"

	"atolla/server/internal/store"
)

func TestFormatInstalledSkillsPromptUsedByService(t *testing.T) {
	block := store.FormatInstalledSkillsPrompt([]store.AgentSkillView{{
		ID: "atolla.search", Name: "网络检索", Summary: "检索",
		Capabilities: []string{"engine.web_search"},
		Rules:        []store.SkillRule{{Type: "deny", Text: "不得抓取私密资源"}},
	}})
	if block == "" {
		t.Fatal("empty block")
	}
	if !contains(block, "## Skills") || !contains(block, "不得抓取私密资源") {
		t.Fatalf("unexpected: %s", block)
	}
}

func TestSyncEngineFlagsFromSkills(t *testing.T) {
	a := &store.ManagedAgent{AllowWrite: true, AllowNetwork: false, AllowBrowser: false}
	store.SyncEngineFlagsFromSkills([]store.AgentSkillView{
		{ID: "atolla.search", Installed: true, Enabled: true, Capabilities: []string{"engine.web_search"}},
		{ID: "atolla.browser", Installed: true, Enabled: true, Capabilities: []string{"engine.browser"}},
	}, a)
	if !a.AllowWrite {
		t.Fatal("allow_write is policy-owned and must stay unchanged")
	}
	if !a.AllowNetwork || !a.AllowBrowser {
		t.Fatalf("flags not synced: %+v", a)
	}
	a2 := &store.ManagedAgent{AllowWrite: true, AllowBrowser: true}
	store.SyncEngineFlagsFromSkills([]store.AgentSkillView{
		{ID: "atolla.search", Installed: true, Enabled: true, Capabilities: []string{"engine.web_search"}},
	}, a2)
	if !a2.AllowWrite {
		t.Fatal("allow_write should not be toggled by skills")
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
