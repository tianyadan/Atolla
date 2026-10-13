package service

import (
	"strings"
	"testing"

	"atolla/server/internal/store"
)

func TestNormalizeLegacySectionsDefault(t *testing.T) {
	got := normalizeLegacySections(nil)
	if len(got) != len(store.AllLegacyMemorySections()) {
		t.Fatalf("empty input should default all sections, got %d", len(got))
	}
	got2 := normalizeLegacySections([]string{"profile", "bogus", "profile", "skills"})
	if len(got2) != 2 || got2[0] != "profile" || got2[1] != "skills" {
		t.Fatalf("unexpected %#v", got2)
	}
}

func TestFormatLegacyMountBlock(t *testing.T) {
	m := &store.LegacyMemory{AgentName: "林晓晴", JobTitle: "产品经理", BodyMarkdown: "## 基本档案\n- ok"}
	out := formatLegacyMountBlock(m)
	if !strings.Contains(out, "继承记忆 · 林晓晴") || !strings.Contains(out, "## 基本档案") {
		t.Fatalf("bad block: %s", out)
	}
}

func TestLegacySectionCatalogComplete(t *testing.T) {
	cat := LegacyMemorySectionCatalog()
	if len(cat) != 9 {
		t.Fatalf("want 9 sections, got %d", len(cat))
	}
}
