package service

import (
	"testing"

	"atolla/server/internal/store"
)

func TestResolveTalentSkillsDynamic(t *testing.T) {
	catalog := []store.SkillCatalogItem{
		{ID: "atolla.search", Name: "网络检索", IconKey: "search", Enabled: true},
		{ID: "atolla.browser", Name: "浏览器操作", IconKey: "browser", Enabled: true},
		{ID: "atolla.database", Name: "数据库访问", IconKey: "database", Enabled: true},
		{ID: "atolla.server_control", Name: "服务器控制", IconKey: "server", Enabled: true},
		{ID: "custom.disabled", Name: "已下架", IconKey: "search", Enabled: false},
	}
	ops := ResolveTalentSkills(catalog, []TalentSkillTag{TalentTagServer, TalentTagDatabase, TalentTagSearch})
	if len(ops) != 3 {
		t.Fatalf("ops want 3 got %d", len(ops))
	}
	ids := map[string]bool{}
	for _, s := range ops {
		ids[s.ID] = true
	}
	for _, want := range []string{"atolla.server_control", "atolla.database", "atolla.search"} {
		if !ids[want] {
			t.Fatalf("missing %s", want)
		}
	}
	// 商店新增同标签技能应被解析到
	catalog = append(catalog, store.SkillCatalogItem{
		ID: "vendor.extra_search", Name: "增强检索", IconKey: "search", Enabled: true,
	})
	ops2 := ResolveTalentSkills(catalog, []TalentSkillTag{TalentTagSearch})
	if len(ops2) != 2 {
		t.Fatalf("search tag should pick up new skill, got %d", len(ops2))
	}
}

func TestTalentPresetsCount(t *testing.T) {
	if n := len(TalentPresets()); n != 6 {
		t.Fatalf("want 6 talents, got %d", n)
	}
	for _, p := range TalentPresets() {
		if p.ID == "" || p.RulesPrompt == "" || len(p.SkillTags) == 0 {
			t.Fatalf("incomplete preset %+v", p.ID)
		}
	}
}
