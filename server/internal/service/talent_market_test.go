package service

import (
	"testing"

	"atolla/server/internal/store"
)

func TestResolveTalentSkillsDynamic(t *testing.T) {
	catalog := []store.SkillCatalogItem{
		{ID: "atolla.coding", Name: "代码读写", IconKey: "coding", Enabled: true},
		{ID: "atolla.shell", Name: "终端执行", IconKey: "shell", Enabled: true},
		{ID: "atolla.search", Name: "网络检索", IconKey: "search", Enabled: true},
		{ID: "atolla.browser", Name: "浏览器操作", IconKey: "browser", Enabled: true},
		{ID: "atolla.database", Name: "数据库访问", IconKey: "database", Enabled: true},
		{ID: "atolla.server_control", Name: "服务器控制", IconKey: "server", Enabled: true},
		{ID: "custom.disabled", Name: "已下架", IconKey: "shell", Enabled: false},
	}
	ops := ResolveTalentSkills(catalog, []TalentSkillTag{TalentTagShell, TalentTagServer, TalentTagDatabase, TalentTagSearch})
	if len(ops) != 4 {
		t.Fatalf("ops want 4 got %d", len(ops))
	}
	ids := map[string]bool{}
	for _, s := range ops {
		ids[s.ID] = true
	}
	for _, want := range []string{"atolla.shell", "atolla.server_control", "atolla.database", "atolla.search"} {
		if !ids[want] {
			t.Fatalf("missing %s", want)
		}
	}
	// 商店新增同标签技能应被解析到
	catalog = append(catalog, store.SkillCatalogItem{
		ID: "vendor.extra_shell", Name: "增强终端", IconKey: "shell", Enabled: true,
	})
	ops2 := ResolveTalentSkills(catalog, []TalentSkillTag{TalentTagShell})
	if len(ops2) != 2 {
		t.Fatalf("shell tag should pick up new skill, got %d", len(ops2))
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
