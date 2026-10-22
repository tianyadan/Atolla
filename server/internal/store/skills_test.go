package store

import (
	"encoding/json"
	"testing"
)

func TestBuiltinSkillSeedsHaveRequiredFields(t *testing.T) {
	seeds := BuiltinSkillSeeds()
	if len(seeds) < 4 {
		t.Fatalf("want >=4 builtin skills, got %d", len(seeds))
	}
	for _, banned := range []string{"atolla.coding", "atolla.shell"} {
		for _, s := range seeds {
			if s.ID == banned {
				t.Fatalf("retired skill still seeded: %s", banned)
			}
		}
	}
	seen := map[string]bool{}
	for _, s := range seeds {
		if s.ID == "" || s.Name == "" || s.Summary == "" || s.IconKey == "" {
			t.Fatalf("incomplete seed: %+v", s)
		}
		if seen[s.ID] {
			t.Fatalf("duplicate id %s", s.ID)
		}
		seen[s.ID] = true
		var rules []SkillRule
		if err := json.Unmarshal([]byte(s.RulesJSON), &rules); err != nil || len(rules) == 0 {
			t.Fatalf("bad rules for %s: %v %s", s.ID, err, s.RulesJSON)
		}
		var caps []SkillCapability
		if err := json.Unmarshal([]byte(s.CapabilitiesJSON), &caps); err != nil || len(caps) == 0 {
			t.Fatalf("bad caps for %s: %v", s.ID, err)
		}
		if s.Source != "builtin" {
			t.Fatalf("source want builtin got %s", s.Source)
		}
	}
}

func TestNormalizeCapabilitiesKeepsKnown(t *testing.T) {
	avail := []SkillCapability{{ID: "db.list"}, {ID: "db.select"}, {ID: "db.write"}}
	got := NormalizeCapabilities([]string{"db.select", "nope", "db.list"}, avail)
	if len(got) != 2 || got[0] != "db.select" || got[1] != "db.list" {
		t.Fatalf("got %#v", got)
	}
}

func TestSkillPromptBlockIsCompact(t *testing.T) {
	block := FormatInstalledSkillsPrompt([]AgentSkillView{{
		ID: "atolla.search", Name: "网络检索", Summary: "检索公开信息",
		Rules:        []SkillRule{{Type: "allow", Text: "可检索"}, {Type: "deny", Text: "不得抓取私密资源"}},
		Capabilities: []string{"engine.web_search"},
	}})
	if block == "" || !containsAll(block, "atolla.search", "engine.web_search", "不得抓取私密资源") {
		t.Fatalf("block=%s", block)
	}
	// database skill is omitted from generic block (injected as compact DS list)
	dbOnly := FormatInstalledSkillsPrompt([]AgentSkillView{{
		ID: "atolla.database", Name: "数据库访问", Summary: "查库",
		Capabilities: []string{"db.sources"},
	}})
	if dbOnly != "" {
		t.Fatalf("database skill should be omitted from generic block, got %q", dbOnly)
	}
}

func TestFormatDBSourcesPromptCompact(t *testing.T) {
	block := FormatDBSourcesPromptCompact([]DBSource{{
		ID: 3, Name: "主库", DBType: "mysql", URL: "127.0.0.1:3306", DatabaseName: "app",
		Username: "u", PermList: true, PermRead: true, Enabled: true, ClientOK: true,
	}})
	if !containsAll(block, "#3", "mysql", "perms=LR", "cli=ok", "主库") {
		t.Fatalf("block=%s", block)
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !containsStr(s, p) {
			return false
		}
	}
	return true
}

func containsStr(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (s == sub || len(s) > 0 && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()))
}
