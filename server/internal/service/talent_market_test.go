package service

import (
	"context"
	"path/filepath"
	"testing"
	"time"

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

// TestHireTalentDoesNotBlockOnBrowserUse 回归：带 browser 技能的岗位招聘不得同步等 EnsureBrowserUse。
func TestHireTalentDoesNotBlockOnBrowserUse(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "hire.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	s := &Service{Store: st}
	ctx := context.Background()
	cw := int64(262144)
	color := "purple"

	started := time.Now()
	a, err := s.HireTalent(ctx, HireTalentInput{
		TalentID:            "fullstack",
		Name:                "苏晚舟-回归",
		Engine:              "agent",
		ContextWindowTokens: &cw,
		JellyColor:          &color,
	})
	elapsed := time.Since(started)
	if err != nil {
		t.Fatalf("HireTalent: %v", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("hire blocked too long: %v (likely sync EnsureBrowserUse)", elapsed)
	}
	if a == nil || a.ID <= 0 {
		t.Fatalf("missing agent: %+v", a)
	}
	skills, err := st.ListAgentSkills(ctx, a.ID)
	if err != nil {
		t.Fatalf("ListAgentSkills: %v", err)
	}
	got := map[string]bool{}
	for _, sk := range skills {
		if sk.Installed {
			got[sk.ID] = true
		}
	}
	for _, want := range []string{"atolla.database", "atolla.browser", "atolla.search"} {
		if !got[want] {
			t.Fatalf("skill %s not installed; got=%v", want, got)
		}
	}
}
