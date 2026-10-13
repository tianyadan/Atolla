package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"

	"atolla/server/internal/store"
)

const maxLegacyMountsPerAgent = 5

// LegacySectionMeta describes a dismiss checklist item for API/UI.
type LegacySectionMeta struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Hint  string `json:"hint"`
}

// LegacyMemorySectionCatalog returns section checklist for dismiss UI.
func LegacyMemorySectionCatalog() []LegacySectionMeta {
	return []LegacySectionMeta{
		{ID: store.LegacySecProfile, Label: "基本档案", Hint: "姓名、岗位、在职概况与主要工作"},
		{ID: store.LegacySecProjects, Label: "项目经历", Hint: "参与/操作过的项目与成果"},
		{ID: store.LegacySecCredentials, Label: "凭据线索", Hint: "账号用途与存放位置（禁止明文密码）"},
		{ID: store.LegacySecDatabase, Label: "数据库知识", Hint: "库表与关键字段含义"},
		{ID: store.LegacySecServers, Label: "服务器与部署", Hint: "环境、服务与发布方式"},
		{ID: store.LegacySecDocs, Label: "文档与原型", Hint: "产品文档与技术原型"},
		{ID: store.LegacySecHabits, Label: "协作习惯", Hint: "工具偏好与流程约定"},
		{ID: store.LegacySecOpenItems, Label: "未竟事项", Hint: "进行中任务、坑点与接手建议"},
		{ID: store.LegacySecSkills, Label: "技能摘要", Hint: "曾安装技能与能力边界"},
	}
}

// DismissManagedInput controls async dismiss + optional memory book.
type DismissManagedInput struct {
	KeepMemory bool
	Sections   []string
	JobTitle   string
}

// DismissManaged removes agent immediately; optionally enqueues legacy memory generation.
func (s *Service) DismissManaged(ctx context.Context, id int64, in DismissManagedInput) (*store.LegacyMemory, error) {
	a, err := s.Store.GetManagedAgent(ctx, id)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fmt.Errorf("not found")
	}
	if !in.KeepMemory {
		return nil, s.DeleteManaged(ctx, id)
	}
	sections := normalizeLegacySections(in.Sections)
	jobTitle := strings.TrimSpace(in.JobTitle)
	if jobTitle == "" {
		jobTitle = "数字员工"
	}
	materials := s.collectLegacyMaterials(ctx, a, sections)
	matsJSON, _ := json.Marshal(materials)
	secJSON, _ := json.Marshal(sections)
	mem := &store.LegacyMemory{
		SourceAgentID: a.ID,
		AgentName:     a.Name,
		JobTitle:      jobTitle,
		AvatarURL:     strings.TrimSpace(a.AvatarURL),
		Engine:        a.Engine,
		Sections:      sections,
		SectionsJSON:  string(secJSON),
		MaterialsJSON: string(matsJSON),
		Status:        "generating",
		BodyMarkdown:  "（记忆生成中…）",
	}
	memID, err := s.Store.InsertLegacyMemory(ctx, mem)
	if err != nil {
		return nil, err
	}
	mem.ID = memID

	if err := s.DeleteManaged(ctx, id); err != nil {
		_ = s.Store.UpdateLegacyMemoryBodyStatus(ctx, memID, "", "failed", "解聘删库失败: "+err.Error())
		return nil, err
	}

	go s.generateLegacyMemoryAsync(memID)
	return mem, nil
}

func normalizeLegacySections(in []string) []string {
	allow := map[string]bool{}
	for _, id := range store.AllLegacyMemorySections() {
		allow[id] = true
	}
	seen := map[string]bool{}
	var out []string
	for _, raw := range in {
		id := strings.TrimSpace(raw)
		if !allow[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	if len(out) == 0 {
		return store.AllLegacyMemorySections()
	}
	return out
}

type legacyMaterials struct {
	AgentName    string   `json:"agent_name"`
	JobTitle     string   `json:"job_title"`
	Engine       string   `json:"engine"`
	RulesPrompt  string   `json:"rules_prompt"`
	Workspace    string   `json:"workspace"`
	Sections     []string `json:"sections"`
	RecentChat   string   `json:"recent_chat"`
	Commands     string   `json:"commands"`
	Skills       string   `json:"skills"`
	DBSources    string   `json:"db_sources"`
	ServerSources string  `json:"server_sources"`
}

func (s *Service) collectLegacyMaterials(ctx context.Context, a *store.ManagedAgent, sections []string) legacyMaterials {
	m := legacyMaterials{
		AgentName:   a.Name,
		Engine:      a.Engine,
		RulesPrompt: TruncateRunes(a.RulesPrompt, 4000),
		Workspace:   a.WorkspacePath,
		Sections:    sections,
	}
	if a.ConversationID > 0 {
		turns, _ := s.Store.RecentTurns(ctx, a.ConversationID, 12)
		var b strings.Builder
		for _, t := range turns {
			u := TruncateRunes(strings.TrimSpace(t.User), 200)
			as := TruncateRunes(strings.TrimSpace(t.Assistant), 200)
			if u != "" {
				b.WriteString("用户: " + u + "\n")
			}
			if as != "" {
				b.WriteString("助手: " + as + "\n")
			}
		}
		m.RecentChat = b.String()
	}
	audits, _ := s.Store.ListCommandAudits(ctx, a.ConversationID, a.ID, 40)
	if len(audits) > 0 {
		var b strings.Builder
		for _, c := range audits {
			line := strings.TrimSpace(c.CommandText)
			if line == "" {
				line = c.ToolName
			}
			b.WriteString(fmt.Sprintf("- [%s] %s\n", c.Decision, TruncateRunes(line, 160)))
		}
		m.Commands = b.String()
	}
	skills, _ := s.Store.ListAgentSkills(ctx, a.ID)
	if len(skills) > 0 {
		var b strings.Builder
		for _, sk := range skills {
			if !sk.Installed || !sk.Enabled {
				continue
			}
			b.WriteString(fmt.Sprintf("- %s (%s)\n", sk.Name, sk.ID))
		}
		m.Skills = b.String()
	}
	if dbs, err := s.Store.ListDBSources(ctx, a.ID); err == nil {
		var b strings.Builder
		for _, d := range dbs {
			b.WriteString(fmt.Sprintf("- %s type=%s url=%s db=%s perms=%s\n",
				d.Name, d.DBType, d.URL, d.DatabaseName, store.DBSourcePermCode(d)))
		}
		m.DBSources = b.String()
	}
	if srvs, err := s.Store.ListServerSources(ctx, a.ID); err == nil {
		var b strings.Builder
		for _, srv := range srvs {
			b.WriteString(fmt.Sprintf("- %s host=%s user=%s allow_delete=%v allow_docker_restart=%v\n",
				srv.Name, srv.Host, srv.Username, srv.AllowDelete, srv.AllowDockerRestart))
		}
		m.ServerSources = b.String()
	}
	return m
}

func (s *Service) generateLegacyMemoryAsync(memID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	mem, err := s.Store.GetLegacyMemory(ctx, memID)
	if err != nil || mem == nil {
		return
	}
	body, genErr := s.generateLegacyMemoryBody(ctx, mem)
	if genErr != nil || strings.TrimSpace(body) == "" {
		msg := "生成失败"
		if genErr != nil {
			msg = TruncateRunes(genErr.Error(), 200)
		}
		fallback := s.fallbackLegacyMemoryBody(mem)
		_ = s.Store.UpdateLegacyMemoryBodyStatus(ctx, memID, fallback, "ready", msg)
		log.Printf("legacy memory %d generate warn: %v", memID, genErr)
		return
	}
	_ = s.Store.UpdateLegacyMemoryBodyStatus(ctx, memID, body, "ready", "")
}

func (s *Service) generateLegacyMemoryBody(ctx context.Context, mem *store.LegacyMemory) (string, error) {
	bin := strings.TrimSpace(s.Cfg.ClaudeBin)
	if bin == "" {
		return "", fmt.Errorf("未配置 claude")
	}
	var mats legacyMaterials
	_ = json.Unmarshal([]byte(mem.MaterialsJSON), &mats)
	if mats.AgentName == "" {
		mats.AgentName = mem.AgentName
	}
	secLabels := map[string]string{}
	for _, c := range LegacyMemorySectionCatalog() {
		secLabels[c.ID] = c.Label
	}
	var want strings.Builder
	for _, id := range mem.Sections {
		want.WriteString("- " + secLabels[id] + " (" + id + ")\n")
	}
	sys := `你是「数字员工离职交接」秘书。根据素材写一份中文 Markdown 离职记忆书。
要求：
1. 只写用户勾选的章节；每章用二级标题。
2. 凭据章节只写用途/账号名/存放位置线索，严禁输出任何明文密码、token、私钥。
3. 信息不足的章节写「素材不足，待接手人补充」。
4. 简洁、可交接；不要编造具体机密数据。
5. 开头用一级标题：# 离职记忆 · {姓名}（{岗位}）`

	user := fmt.Sprintf(`姓名：%s
岗位：%s
引擎：%s
需要章节：
%s
【规则摘要】
%s
【工作区】%s
【近期对话】
%s
【命令审计】
%s
【技能】
%s
【数据源（无密码）】
%s
【服务器（无密码）】
%s

请输出完整 Markdown。`,
		mem.AgentName, mem.JobTitle, mem.Engine, want.String(),
		mats.RulesPrompt, mats.Workspace, mats.RecentChat, mats.Commands,
		mats.Skills, mats.DBSources, mats.ServerSources)

	cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	// 新版 Claude CLI 用 --permission-mode，已无 --permission-prompts
	cmd := exec.CommandContext(cctx, bin, "-p",
		"--output-format", "text",
		"--system-prompt", sys,
		"--tools", "",
		"--permission-mode", "dontAsk",
		"--no-session-persistence",
	)
	cmd.Stdin = strings.NewReader(user)
	if s.Reviewer != nil && len(s.Reviewer.Env) > 0 {
		cmd.Env = s.Reviewer.Env
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("claude: %w (%s)", err, TruncateRunes(stderr.String(), 160))
	}
	out := strings.TrimSpace(stdout.String())
	if out == "" {
		return "", fmt.Errorf("empty model output")
	}
	return out, nil
}

func (s *Service) fallbackLegacyMemoryBody(mem *store.LegacyMemory) string {
	var mats legacyMaterials
	_ = json.Unmarshal([]byte(mem.MaterialsJSON), &mats)
	var b strings.Builder
	b.WriteString(fmt.Sprintf("# 离职记忆 · %s（%s）\n\n", mem.AgentName, mem.JobTitle))
	b.WriteString("> 自动摘要未完全成功，以下为素材摘录，管理员可在书架中编辑补全。\n\n")
	b.WriteString("## 基本档案\n\n")
	b.WriteString(fmt.Sprintf("- 姓名：%s\n- 岗位：%s\n- 引擎：%s\n\n", mem.AgentName, mem.JobTitle, mem.Engine))
	if mats.Skills != "" {
		b.WriteString("## 技能摘要\n\n" + mats.Skills + "\n")
	}
	if mats.DBSources != "" {
		b.WriteString("## 数据库知识\n\n" + mats.DBSources + "\n")
	}
	if mats.ServerSources != "" {
		b.WriteString("## 服务器与部署\n\n" + mats.ServerSources + "\n")
	}
	if mats.Commands != "" {
		b.WriteString("## 项目/命令线索\n\n" + TruncateRunes(mats.Commands, 2000) + "\n")
	}
	return b.String()
}

// ListLegacyMemoryShelf returns books for the memory library.
func (s *Service) ListLegacyMemoryShelf(ctx context.Context) ([]store.LegacyMemory, error) {
	items, err := s.Store.ListLegacyMemoriesShelf(ctx)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].MaterialsJSON = "" // hide bulky materials on list
	}
	return items, nil
}

// GetLegacyMemory returns one book (materials omitted).
func (s *Service) GetLegacyMemory(ctx context.Context, id int64) (*store.LegacyMemory, error) {
	m, err := s.Store.GetLegacyMemory(ctx, id)
	if err != nil || m == nil {
		return m, err
	}
	m.MaterialsJSON = ""
	return m, nil
}

// UpdateLegacyMemory edits ready/failed book body.
func (s *Service) UpdateLegacyMemory(ctx context.Context, id int64, body, jobTitle string) (*store.LegacyMemory, error) {
	m, err := s.Store.GetLegacyMemory(ctx, id)
	if err != nil || m == nil {
		return nil, fmt.Errorf("not found")
	}
	if m.Status != "ready" && m.Status != "failed" {
		return nil, fmt.Errorf("memory not editable in status %s", m.Status)
	}
	if err := s.Store.UpdateLegacyMemoryBody(ctx, id, body, jobTitle); err != nil {
		return nil, err
	}
	return s.GetLegacyMemory(ctx, id)
}

// RetryLegacyMemoryGeneration re-runs AI for failed/generating books.
func (s *Service) RetryLegacyMemoryGeneration(ctx context.Context, id int64) error {
	m, err := s.Store.GetLegacyMemory(ctx, id)
	if err != nil || m == nil {
		return fmt.Errorf("not found")
	}
	if m.Status == "claimed" {
		return fmt.Errorf("already claimed")
	}
	_ = s.Store.UpdateLegacyMemoryBodyStatus(ctx, id, m.BodyMarkdown, "generating", "")
	go s.generateLegacyMemoryAsync(id)
	return nil
}

// ClaimLegacyMemory mounts a book onto an agent once (max 5).
func (s *Service) ClaimLegacyMemory(ctx context.Context, memoryID, agentID int64) error {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return fmt.Errorf("agent not found")
	}
	m, err := s.Store.GetLegacyMemory(ctx, memoryID)
	if err != nil || m == nil {
		return fmt.Errorf("memory not found")
	}
	if m.Status != "ready" {
		return fmt.Errorf("memory not ready")
	}
	n, err := s.Store.CountAgentLegacyMounts(ctx, agentID)
	if err != nil {
		return err
	}
	if n >= maxLegacyMountsPerAgent {
		return fmt.Errorf("每位数字员工最多挂载 %d 本记忆", maxLegacyMountsPerAgent)
	}
	block := formatLegacyMountBlock(m)
	if err := s.Store.AppendManagedAgentRulesPrompt(ctx, agentID, block); err != nil {
		return err
	}
	if err := s.Store.MarkLegacyMemoryClaimed(ctx, memoryID, agentID); err != nil {
		return err
	}
	_, err = s.Store.InsertAgentLegacyMemoryMount(ctx, store.AgentLegacyMemoryMount{
		AgentID:         agentID,
		LegacyMemoryID:  memoryID,
		SourceAgentName: m.AgentName,
		SourceJobTitle:  m.JobTitle,
		SourceAvatarURL: m.AvatarURL,
	})
	return err
}

func formatLegacyMountBlock(m *store.LegacyMemory) string {
	body := strings.TrimSpace(m.BodyMarkdown)
	if utf8.RuneCountInString(body) > 12000 {
		body = TruncateRunes(body, 12000) + "\n…（已截断）"
	}
	return fmt.Sprintf("\n\n---\n## 继承记忆 · %s（%s）\n\n%s\n", m.AgentName, m.JobTitle, body)
}

// ListAgentLegacyMounts returns mounts for settings UI.
func (s *Service) ListAgentLegacyMounts(ctx context.Context, agentID int64) ([]store.AgentLegacyMemoryMount, error) {
	return s.Store.ListAgentLegacyMemoryMounts(ctx, agentID)
}
