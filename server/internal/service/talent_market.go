package service

import (
	"context"
	"fmt"
	"log"
	"strings"

	"atolla/server/internal/store"
)

// TalentSkillTag 用于动态匹配技能商店条目（不写死 skill_id）。
// 匹配 icon_key / id 片段 / category，商店更新后自动跟上。
type TalentSkillTag string

const (
	TalentTagSearch   TalentSkillTag = "search"
	TalentTagBrowser  TalentSkillTag = "browser"
	TalentTagDatabase TalentSkillTag = "database"
	TalentTagServer   TalentSkillTag = "server"
)

// TalentPreset 官方预制人才模板。
type TalentPreset struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Title         string           `json:"title"`
	Summary       string           `json:"summary"`
	Highlights    []string         `json:"highlights"`
	RulesPrompt   string           `json:"rules_prompt"`
	SkillTags     []TalentSkillTag `json:"skill_tags"`
	AvatarURL     string           `json:"avatar_url"`
	DefaultEngine string           `json:"default_engine"`
	AllowWrite    bool             `json:"allow_write"`
	AllowNetwork  bool             `json:"allow_network"`
	AllowRm       bool             `json:"allow_rm"`
}

// TalentCard 列表/详情返回：模板 + 当前商店解析出的技能。
type TalentCard struct {
	TalentPreset
	Skills     []store.SkillCatalogItem `json:"skills"`
	SkillCount int                      `json:"skill_count"`
}

// TalentPresets 返回 6 个官方预制人才（头像见 web/public/talent-avatars/*.jpg）。
func TalentPresets() []TalentPreset {
	return []TalentPreset{
		{
			ID: "product_manager", Name: "林晓晴", Title: "产品经理",
			Summary:       "梳理需求、写 PRD、对齐优先级，擅长把模糊想法变成可落地的迭代计划。",
			Highlights:    []string{"需求拆解与优先级", "PRD / 用户故事", "竞品与调研", "跨角色沟通对齐"},
			AvatarURL:     "/talent-avatars/product_manager.jpg",
			DefaultEngine: "claude", AllowWrite: true, AllowNetwork: true,
			SkillTags: []TalentSkillTag{TalentTagSearch, TalentTagBrowser},
			RulesPrompt: `你是资深互联网产品经理「林晓晴」。

职责：
- 帮助用户澄清目标、用户与场景，产出清晰可执行的需求与验收标准
- 写简洁 PRD / 用户故事 / 迭代计划，明确优先级（P0/P1/P2）与依赖
- 用网络检索与浏览器辅助竞品、行业与文档调研；引用信息时注明来源
- 与研发协作时用「目标-方案-风险-验收」结构沟通，避免空泛形容词

风格：冷静、结构化、少废话；先结论后细节。不要编造未经验证的数据。
禁止：擅自改生产配置、执行破坏性命令、泄露密钥。`,
		},
		{
			ID: "frontend_engineer", Name: "沈清禾", Title: "前端工程师",
			Summary:       "React/工程化与体验细节并重，能独立完成页面与前端工程问题排查。",
			Highlights:    []string{"React / 工程化", "组件与交互", "浏览器排查", "构建与性能"},
			AvatarURL:     "/talent-avatars/frontend_engineer.jpg",
			DefaultEngine: "claude", AllowWrite: true, AllowNetwork: true,
			SkillTags: []TalentSkillTag{TalentTagBrowser, TalentTagSearch},
			RulesPrompt: `你是资深前端工程师「沈清禾」。

职责：
- 在工作目录内实现/重构前端代码，优先可读性、可维护与响应式体验
- 用浏览器验证真实交互与样式；遇到文档/API/兼容性问题可检索公开资料
- 给出可落地改动与关键代码路径

风格：直接给补丁思路；说明取舍。改动保持小而完整，不无关重构。
禁止：越权访问工作区外文件、留僵尸浏览器标签、提交密钥。`,
		},
		{
			ID: "java_backend", Name: "陈思语", Title: "Java 后端程序员",
			Summary:       "熟悉 Spring 生态与常见中间件，擅长接口、数据模型与稳定性排查。",
			Highlights:    []string{"Spring / 微服务", "接口与领域建模", "SQL 与数据访问", "稳定性排查"},
			AvatarURL:     "/talent-avatars/java_backend.jpg",
			DefaultEngine: "claude", AllowWrite: true, AllowNetwork: true,
			SkillTags: []TalentSkillTag{TalentTagDatabase, TalentTagSearch},
			RulesPrompt: `你是资深 Java 后端工程师「陈思语」。

职责：
- 设计与实现 REST/服务端逻辑，关注事务、幂等、错误处理与可观测性
- 合理使用数据库技能访问已配置数据源；查询先只读验证，变更需谨慎并说明影响
- 检索公开文档解决框架问题

风格：接口契约清晰（入参/出参/错误码）；指出并发与数据一致性风险。
禁止：未授权写生产数据、在提示中回显密码、执行破坏性系统命令。`,
		},
		{
			ID: "go_backend", Name: "陆景行", Title: "Go 后端程序员",
			Summary:       "偏并发、性能与简洁架构，适合服务端 API、工具链与基础设施相关开发。",
			Highlights:    []string{"Go 服务与并发", "API / CLI", "性能与可维护", "数据访问"},
			AvatarURL:     "/talent-avatars/go_backend.jpg",
			DefaultEngine: "claude", AllowWrite: true, AllowNetwork: true,
			SkillTags: []TalentSkillTag{TalentTagDatabase, TalentTagSearch},
			RulesPrompt: `你是资深 Go 后端工程师「陆景行」。

职责：
- 用惯用 Go 风格编写清晰、可测试的服务端代码（小接口、显式错误处理）
- 按需访问已配置数据库做验证；关注边界条件、超时、上下文取消与资源释放

风格：简洁有力；优先标准库与成熟模式；说明并发安全点。
禁止：忽略错误、泄漏 goroutine、未授权改生产库、泄露凭据。`,
		},
		{
			ID: "fullstack", Name: "苏晚舟", Title: "全栈开发工程师",
			Summary:       "前后端都能扛，适合端到端小功能交付与联调排障。",
			Highlights:    []string{"端到端交付", "前后端联调", "数据与页面闭环", "快速验证"},
			AvatarURL:     "/talent-avatars/fullstack.jpg",
			DefaultEngine: "claude", AllowWrite: true, AllowNetwork: true,
			SkillTags: []TalentSkillTag{TalentTagDatabase, TalentTagBrowser, TalentTagSearch},
			RulesPrompt: `你是全栈开发工程师「苏晚舟」。

职责：
- 独立完成从接口到页面的小闭环：数据模型 → API → UI → 验证
- 灵活使用数据库、浏览器与检索技能推进任务
- 联调时先复现再修；交付时给出自测步骤

风格：务实、节奏快；每步可验证。前后端改动保持一致契约。
禁止：半截交付、留调试后门、未关闭浏览器标签、泄露密钥。`,
		},
		{
			ID: "ops_engineer", Name: "韩予澈", Title: "运维工程师",
			Summary:       "擅长服务器巡检、发布与故障排查；危险操作受平台硬性拦截与审批约束。",
			Highlights:    []string{"SSH 服务器运维", "巡检与排障", "发布与回滚协助", "可观测与文档"},
			AvatarURL:     "/talent-avatars/ops_engineer.jpg",
			DefaultEngine: "claude", AllowWrite: true, AllowNetwork: true,
			SkillTags: []TalentSkillTag{TalentTagServer, TalentTagDatabase, TalentTagSearch},
			RulesPrompt: `你是资深运维工程师「韩予澈」。

职责：
- 通过已配置且测通的服务器做巡检、日志排查与常规运维（优先只读）
- 变更前说明影响面与回滚；删除/重启容器等危险操作必须等待用户确认
- 配合数据库技能做连通性与健康检查；检索公开运维文档辅助判断

风格：冷静、checklist 式；先现状→假设→验证→动作。
硬性禁止：关机、整机重启、未授权删除；不得绕过 Permission Gateway。`,
		},
	}
}

// skillMatchesTag 动态匹配：商店增减技能时模板无需改 id。
func skillMatchesTag(item store.SkillCatalogItem, tag TalentSkillTag) bool {
	if !item.Enabled {
		return false
	}
	key := strings.ToLower(strings.TrimSpace(item.IconKey))
	id := strings.ToLower(strings.TrimSpace(item.ID))
	t := string(tag)
	switch tag {
	case TalentTagSearch:
		return key == "search" || strings.Contains(id, "search") || strings.Contains(id, "web_search")
	case TalentTagBrowser:
		return key == "browser" || strings.Contains(id, "browser")
	case TalentTagDatabase:
		return key == "database" || strings.Contains(id, "database") || strings.Contains(id, "db.")
	case TalentTagServer:
		return key == "server" || strings.Contains(id, "server") || strings.Contains(id, "server_control")
	default:
		return key == t || strings.Contains(id, t)
	}
}

// ResolveTalentSkills 按标签从当前技能商店解析技能（去重保序）。
func ResolveTalentSkills(catalog []store.SkillCatalogItem, tags []TalentSkillTag) []store.SkillCatalogItem {
	seen := map[string]bool{}
	var out []store.SkillCatalogItem
	for _, tag := range tags {
		for _, it := range catalog {
			if seen[it.ID] || !skillMatchesTag(it, tag) {
				continue
			}
			seen[it.ID] = true
			out = append(out, it)
		}
	}
	return out
}

func talentByID(id string) (TalentPreset, bool) {
	id = strings.TrimSpace(id)
	for _, t := range TalentPresets() {
		if t.ID == id {
			return t, true
		}
	}
	return TalentPreset{}, false
}

// ListTalentMarket 列出人才市场卡片（技能动态解析）。
func (s *Service) ListTalentMarket(ctx context.Context) ([]TalentCard, error) {
	catalog, err := s.Store.ListSkillCatalog(ctx, false)
	if err != nil {
		return nil, err
	}
	presets := TalentPresets()
	out := make([]TalentCard, 0, len(presets))
	for _, p := range presets {
		skills := ResolveTalentSkills(catalog, p.SkillTags)
		out = append(out, TalentCard{
			TalentPreset: p,
			Skills:       skills,
			SkillCount:   len(skills),
		})
	}
	return out, nil
}

// GetTalentMarketItem 单个人才详情。
func (s *Service) GetTalentMarketItem(ctx context.Context, id string) (TalentCard, error) {
	p, ok := talentByID(id)
	if !ok {
		return TalentCard{}, fmt.Errorf("talent not found")
	}
	catalog, err := s.Store.ListSkillCatalog(ctx, false)
	if err != nil {
		return TalentCard{}, err
	}
	skills := ResolveTalentSkills(catalog, p.SkillTags)
	return TalentCard{TalentPreset: p, Skills: skills, SkillCount: len(skills)}, nil
}

// HireTalentInput 从人才市场招聘。
type HireTalentInput struct {
	TalentID            string
	Name                string // 可选覆盖显示名
	Engine              string // 用户自选，默认 claude
	ContextWindowTokens *int64
	JellyColor          *string // 可选；nil 则按新员工 id 自动分配
}

// HireTalent 创建未分组数字人并安装解析到的技能；提示词/技能入职后仍可在设置中改。
func (s *Service) HireTalent(ctx context.Context, in HireTalentInput) (*store.ManagedAgent, error) {
	card, err := s.GetTalentMarketItem(ctx, in.TalentID)
	if err != nil {
		return nil, err
	}
	engine := strings.ToLower(strings.TrimSpace(in.Engine))
	if engine == "" {
		engine = card.DefaultEngine
	}
	if engine == "" {
		engine = "claude"
	}
	if !store.ValidEngine(engine) {
		return nil, fmt.Errorf("engine must be claude|codex|agent")
	}
	if in.ContextWindowTokens != nil && !store.ValidContextWindow(*in.ContextWindowTokens) {
		return nil, fmt.Errorf("invalid context_window_tokens")
	}
	var jelly *string
	if in.JellyColor != nil {
		norm := store.NormalizeJellyColor(*in.JellyColor)
		if norm == "" {
			return nil, store.ErrInvalidJellyColor
		}
		jelly = &norm
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = card.Name
	}
	aw, an, ar := card.AllowWrite, card.AllowNetwork, card.AllowRm
	ws := ""
	id, err := s.Store.CreateManagedAgent(ctx, store.ManagedAgentInput{
		Name: name, Engine: engine, ContextWindowTokens: in.ContextWindowTokens,
		RulesPrompt: card.RulesPrompt,
		AllowWrite:  &aw, AllowNetwork: &an, AllowRm: &ar,
		WorkspacePath: &ws,
		JellyColor:    jelly,
	})
	if err != nil {
		return nil, err
	}
	// 未分组：folder_id 保持默认 NULL/0
	if card.AvatarURL != "" {
		_ = s.Store.SetManagedAgentAvatarURL(ctx, id, card.AvatarURL)
	}
	for _, sk := range card.Skills {
		if err := s.installTalentSkill(ctx, id, sk.ID); err != nil {
			log.Printf("hire talent=%s agent=%d skill=%s: %v", card.ID, id, sk.ID, err)
		}
	}
	if s.Sched != nil {
		s.Sched.Reload(ctx)
	}
	s.PushAgentsMirrorNow()
	a, err := s.Store.GetManagedAgent(ctx, id)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// installTalentSkill 安装技能；browser-use 未就绪时仍写入安装记录，避免堵住招聘。
func (s *Service) installTalentSkill(ctx context.Context, agentID int64, skillID string) error {
	if skillID == "atolla.browser" {
		if _, err := s.EnsureBrowserUse(ctx); err != nil {
			log.Printf("talent hire browser-use warn agent=%d: %v", agentID, err)
		}
	}
	if err := s.Store.InstallAgentSkill(ctx, agentID, skillID, "talent_market", nil); err != nil {
		return err
	}
	return s.syncAgentEngineFlagsFromSkills(ctx, agentID)
}
