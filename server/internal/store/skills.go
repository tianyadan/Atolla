package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// SkillRule is a human-readable allow/deny/note for prompts and UI.
type SkillRule struct {
	Type string `json:"type"` // allow | deny | note
	Text string `json:"text"`
}

// SkillCapability describes a capability chip in the store catalog.
type SkillCapability struct {
	ID          string `json:"id"`
	Label       string `json:"label,omitempty"`
	Description string `json:"description,omitempty"`
	DefaultOn   bool   `json:"default_on,omitempty"`
}

// SkillCatalogItem is one row in skill_catalog.
type SkillCatalogItem struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Summary          string            `json:"summary"`
	Description      string            `json:"description"`
	IconKey          string            `json:"icon_key"`
	IconURL          string            `json:"icon_url,omitempty"`
	Source           string            `json:"source"` // builtin | custom
	PublisherID      string            `json:"publisher_id,omitempty"`
	PublisherName    string            `json:"publisher_name,omitempty"`
	Category         string            `json:"category"`
	Risk             string            `json:"risk"` // low | mid | high
	Author           string            `json:"author,omitempty"`
	Rules            []SkillRule       `json:"rules"`
	Capabilities     []SkillCapability `json:"capabilities"`
	Version          string            `json:"version"`
	Enabled          bool              `json:"enabled"`
	InstallCount     int               `json:"install_count"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
	RulesJSON        string            `json:"-"`
	CapabilitiesJSON string            `json:"-"`
}

// AgentSkillView is catalog + install state for one agent.
type AgentSkillView struct {
	ID               string      `json:"id"`
	Name             string      `json:"name"`
	Summary          string      `json:"summary"`
	Description      string      `json:"description"`
	IconKey          string      `json:"icon_key"`
	IconURL          string      `json:"icon_url,omitempty"`
	Source           string      `json:"source"`
	PublisherName    string      `json:"publisher_name,omitempty"`
	Category         string      `json:"category"`
	Risk             string      `json:"risk"`
	Author           string      `json:"author,omitempty"`
	Rules            []SkillRule `json:"rules"`
	Capabilities     []string    `json:"capabilities"` // enabled capability ids
	AllCapabilities  []SkillCapability `json:"all_capabilities,omitempty"`
	Version          string      `json:"version"`
	Installed        bool        `json:"installed"`
	Enabled          bool        `json:"enabled"` // install enabled flag
	InstalledAt      *time.Time  `json:"installed_at,omitempty"`
	ConfigJSON       string      `json:"config_json,omitempty"`
}

// EnsureSkillSchema creates skill tables and seeds builtin catalog.
func (s *Store) EnsureSkillSchema(ctx context.Context) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS skill_catalog (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  summary VARCHAR(512) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  icon_key VARCHAR(64) NOT NULL DEFAULT 'custom',
  icon_url VARCHAR(1024) NULL,
  source ENUM('builtin','custom') NOT NULL DEFAULT 'builtin',
  publisher_id VARCHAR(64) NULL,
  publisher_name VARCHAR(128) NULL,
  author VARCHAR(128) NOT NULL DEFAULT 'Atolla',
  category VARCHAR(64) NOT NULL DEFAULT 'general',
  risk VARCHAR(16) NOT NULL DEFAULT 'mid',
  rules_json JSON NOT NULL,
  capabilities_json JSON NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  install_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_skill_source (source),
  INDEX idx_skill_category (category),
  INDEX idx_skill_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS agent_skill_installs (
  agent_id BIGINT NOT NULL,
  skill_id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  enabled_capabilities_json JSON NOT NULL,
  config_json JSON NULL,
  installed_by VARCHAR(64) NULL,
  installed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (agent_id, skill_id),
  CONSTRAINT fk_asi_agent FOREIGN KEY (agent_id) REFERENCES managed_agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_asi_skill FOREIGN KEY (skill_id) REFERENCES skill_catalog(id) ON DELETE CASCADE,
  INDEX idx_asi_skill (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	}
	for _, q := range stmts {
		if _, err := s.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("ensure skill schema: %w", err)
		}
	}
	// Upgrade columns if an older partial table exists.
	for _, col := range []struct{ name, ddl string }{
		{"author", `ALTER TABLE skill_catalog ADD COLUMN author VARCHAR(128) NOT NULL DEFAULT 'Atolla' AFTER publisher_name`},
		{"risk", `ALTER TABLE skill_catalog ADD COLUMN risk VARCHAR(16) NOT NULL DEFAULT 'mid' AFTER category`},
	} {
		var n int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skill_catalog' AND COLUMN_NAME = ?`, col.name,
		).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			if _, err := s.db.ExecContext(ctx, col.ddl); err != nil {
				return fmt.Errorf("add skill_catalog.%s: %w", col.name, err)
			}
		}
	}
	var enCol int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_skill_installs' AND COLUMN_NAME = 'enabled'`,
	).Scan(&enCol); err != nil {
		return err
	}
	if enCol == 0 {
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE agent_skill_installs ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER skill_id`); err != nil {
			return fmt.Errorf("add agent_skill_installs.enabled: %w", err)
		}
	}
	return s.seedBuiltinSkills(ctx)
}

func (s *Store) seedBuiltinSkills(ctx context.Context) error {
	for _, seed := range BuiltinSkillSeeds() {
		_, err := s.db.ExecContext(ctx, `
INSERT INTO skill_catalog (
  id, name, summary, description, icon_key, icon_url, source, author, category, risk,
  rules_json, capabilities_json, version, enabled
) VALUES (?, ?, ?, ?, ?, ?, 'builtin', ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 1)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  summary=VALUES(summary),
  description=VALUES(description),
  icon_key=VALUES(icon_key),
  icon_url=VALUES(icon_url),
  author=VALUES(author),
  category=VALUES(category),
  risk=VALUES(risk),
  rules_json=VALUES(rules_json),
  capabilities_json=VALUES(capabilities_json),
  version=VALUES(version),
  enabled=1`,
			seed.ID, seed.Name, seed.Summary, seed.Description, seed.IconKey, nullIfEmpty(seed.IconURL),
			seed.Author, seed.Category, seed.Risk,
			seed.RulesJSON, seed.CapabilitiesJSON, seed.Version,
		)
		if err != nil {
			return fmt.Errorf("seed skill %s: %w", seed.ID, err)
		}
	}
	return nil
}

// BuiltinSkillSeeds returns the built-in marketplace catalog.
func BuiltinSkillSeeds() []SkillCatalogItem {
	rule := func(typ, text string) SkillRule { return SkillRule{Type: typ, Text: text} }
	cap := func(id, label, desc string, on bool) SkillCapability {
		return SkillCapability{ID: id, Label: label, Description: desc, DefaultOn: on}
	}
	mustJSON := func(v any) string {
		b, _ := json.Marshal(v)
		return string(b)
	}
	mk := func(id, name, summary, desc, icon, cat, risk, ver string, rules []SkillRule, caps []SkillCapability) SkillCatalogItem {
		return SkillCatalogItem{
			ID: id, Name: name, Summary: summary, Description: desc,
			IconKey: icon, Source: "builtin", Author: "Atolla", Category: cat, Risk: risk, Version: ver,
			Rules: rules, Capabilities: caps,
			RulesJSON: mustJSON(rules), CapabilitiesJSON: mustJSON(caps),
		}
	}
	return []SkillCatalogItem{
		mk("atolla.coding", "代码读写", "在工作目录读改代码与配置",
			"允许 Agent 在工作目录内读写文件。适合开发助手。",
			"coding", "engine", "mid", "1.0.0",
			[]SkillRule{
				rule("allow", "可读工作目录内文件"),
				rule("allow", "可按策略修改工作目录内文件"),
				rule("deny", "不得越出工作目录"),
			},
			[]SkillCapability{
				cap("engine.read", "读文件", "读取工作目录文件", true),
				cap("engine.write", "写文件", "修改工作目录文件", true),
			}),
		mk("atolla.shell", "终端执行", "运行 shell 命令完成构建与排查",
			"允许 Agent 执行终端命令。建议搭配人工审批。",
			"shell", "engine", "high", "1.0.0",
			[]SkillRule{
				rule("allow", "可执行与任务相关的命令"),
				rule("deny", "禁止破坏性系统命令（除非用户明确授权）"),
				rule("note", "危险命令应走 Permission Gateway 审批"),
			},
			[]SkillCapability{cap("engine.exec", "执行命令", "运行 shell", true)}),
		mk("atolla.search", "网络检索", "搜索公开信息与文档",
			"允许 Agent 发起网络搜索辅助调研。",
			"search", "engine", "low", "1.0.0",
			[]SkillRule{rule("allow", "可检索公开网络信息"), rule("deny", "不得用于抓取私密/未授权资源")},
			[]SkillCapability{cap("engine.web_search", "网络搜索", "搜索公开信息", true)}),
		func() SkillCatalogItem {
			item := mk("atolla.browser", "浏览器操作", "依赖 browser-use，操作真实浏览器",
				"安装时自动检测本机 browser-use；若缺失则尝试自动下载安装。开启后数字员工可通过 browser-use 打开网页、点击、填表；用完必须关闭标签，禁止留下僵尸页。",
				"browser", "engine", "mid", "1.2.0",
				[]SkillRule{
					rule("allow", "可使用 browser-use 打开与任务相关的网页并交互"),
					rule("deny", "禁止在任务结束后保留未关闭的浏览器标签/窗口"),
					rule("note", "用完网页须及时关闭，勿留僵尸页；注意勿泄露凭据"),
				},
				[]SkillCapability{cap("engine.browser", "浏览器", "browser-use 自动化", true)})
			item.IconURL = "/skill-icons/browser.svg"
			return item
		}(),
		func() SkillCatalogItem {
			item := mk("atolla.database", "数据库访问", "配置多数据源，按库分离增删改查",
				"安装后可配置 MySQL、PostgreSQL、Redis、MongoDB 等常用库。密码加密保存；按数据源分别勾选读写权限。",
				"database", "data", "mid", "1.2.0",
				[]SkillRule{
					rule("allow", "仅访问已配置且启用的数据源"),
					rule("allow", "按该源勾选的 L/R/C/U/D 操作"),
					rule("deny", "禁止越权、禁止在提示中回显密码"),
					rule("note", "cli=ok 时优先用本机客户端"),
				},
				[]SkillCapability{
					cap("db.sources", "多数据源", "配置与使用多个库", true),
				})
			item.IconURL = "/skill-icons/database.svg"
			return item
		}(),
		func() SkillCatalogItem {
			item := mk("atolla.server_control", "服务器控制", "多台 SSH 服务器运维（破坏性操作硬拦截）",
				"安装后可添加多台服务器（地址/账号/密码）。默认禁止删除、重启、关机；可勾选「允许删除」「允许重启 Docker」，但每次操作仍须人工确认。规则在权限网关硬执行，不依赖提示词。",
				"server", "ops", "high", "1.1.0",
				[]SkillRule{
					rule("allow", "可 SSH 连接已配置且测通的服务器做只读/常规运维"),
					rule("deny", "禁止关机、整机重启、系统服务强制重启"),
					rule("deny", "未勾选时禁止删除/停止容器与文件"),
					rule("note", "勾选危险权限后仍每次询问用户"),
				},
				[]SkillCapability{
					cap("server.ssh", "SSH 运维", "多服务器连接", true),
					cap("server.delete", "删除(需勾选+询问)", "删除/停止类操作", false),
					cap("server.docker_restart", "重启容器(需勾选+询问)", "docker restart", false),
				})
			item.IconURL = "/skill-icons/server.svg"
			return item
		}(),
	}
}

// ListSkillCatalog returns enabled store skills (optionally include disabled for admin).
func (s *Store) ListSkillCatalog(ctx context.Context, includeDisabled bool) ([]SkillCatalogItem, error) {
	q := `SELECT id, name, summary, description, icon_key, COALESCE(icon_url,''), source,
 COALESCE(publisher_id,''), COALESCE(publisher_name,''), COALESCE(author,''), category, COALESCE(risk,'mid'),
 CAST(rules_json AS CHAR), CAST(capabilities_json AS CHAR), version, enabled, install_count,
 created_at, updated_at
 FROM skill_catalog`
	if !includeDisabled {
		q += ` WHERE enabled=1`
	}
	q += ` ORDER BY source ASC, category ASC, name ASC`
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SkillCatalogItem
	for rows.Next() {
		item, err := scanSkillCatalog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func scanSkillCatalog(rows *sql.Rows) (SkillCatalogItem, error) {
	var it SkillCatalogItem
	var enabled int
	var rulesRaw, capsRaw string
	err := rows.Scan(
		&it.ID, &it.Name, &it.Summary, &it.Description, &it.IconKey, &it.IconURL, &it.Source,
		&it.PublisherID, &it.PublisherName, &it.Author, &it.Category, &it.Risk,
		&rulesRaw, &capsRaw, &it.Version, &enabled, &it.InstallCount,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return it, err
	}
	it.Enabled = enabled == 1
	it.RulesJSON = rulesRaw
	it.CapabilitiesJSON = capsRaw
	_ = json.Unmarshal([]byte(rulesRaw), &it.Rules)
	_ = json.Unmarshal([]byte(capsRaw), &it.Capabilities)
	if it.Rules == nil {
		it.Rules = []SkillRule{}
	}
	if it.Capabilities == nil {
		it.Capabilities = []SkillCapability{}
	}
	return it, nil
}

// GetSkillCatalog returns one catalog skill.
func (s *Store) GetSkillCatalog(ctx context.Context, id string) (SkillCatalogItem, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, name, summary, description, icon_key, COALESCE(icon_url,''), source,
 COALESCE(publisher_id,''), COALESCE(publisher_name,''), COALESCE(author,''), category, COALESCE(risk,'mid'),
 CAST(rules_json AS CHAR), CAST(capabilities_json AS CHAR), version, enabled, install_count,
 created_at, updated_at
 FROM skill_catalog WHERE id=?`, id)
	var it SkillCatalogItem
	var enabled int
	var rulesRaw, capsRaw string
	err := row.Scan(
		&it.ID, &it.Name, &it.Summary, &it.Description, &it.IconKey, &it.IconURL, &it.Source,
		&it.PublisherID, &it.PublisherName, &it.Author, &it.Category, &it.Risk,
		&rulesRaw, &capsRaw, &it.Version, &enabled, &it.InstallCount,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return it, err
	}
	it.Enabled = enabled == 1
	_ = json.Unmarshal([]byte(rulesRaw), &it.Rules)
	_ = json.Unmarshal([]byte(capsRaw), &it.Capabilities)
	return it, nil
}

// ListAgentSkills merges catalog with install state for one agent.
func (s *Store) ListAgentSkills(ctx context.Context, agentID int64) ([]AgentSkillView, error) {
	catalog, err := s.ListSkillCatalog(ctx, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT skill_id, enabled, CAST(enabled_capabilities_json AS CHAR), COALESCE(CAST(config_json AS CHAR),''), installed_at
FROM agent_skill_installs WHERE agent_id=?`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type inst struct {
		caps    []string
		cfg     string
		at      time.Time
		enabled bool
	}
	installed := map[string]inst{}
	for rows.Next() {
		var sid, capsRaw, cfg string
		var at time.Time
		var en int
		if err := rows.Scan(&sid, &en, &capsRaw, &cfg, &at); err != nil {
			return nil, err
		}
		var caps []string
		_ = json.Unmarshal([]byte(capsRaw), &caps)
		installed[sid] = inst{caps: caps, cfg: cfg, at: at, enabled: en == 1}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]AgentSkillView, 0, len(catalog))
	for _, c := range catalog {
		v := AgentSkillView{
			ID: c.ID, Name: c.Name, Summary: c.Summary, Description: c.Description,
			IconKey: c.IconKey, IconURL: c.IconURL, Source: c.Source,
			PublisherName: c.PublisherName, Category: c.Category, Risk: c.Risk, Author: c.Author,
			Rules: c.Rules, AllCapabilities: c.Capabilities, Version: c.Version,
		}
		if in, ok := installed[c.ID]; ok {
			v.Installed = true
			v.Enabled = in.enabled
			v.Capabilities = in.caps
			v.ConfigJSON = in.cfg
			t := in.at
			v.InstalledAt = &t
		} else {
			v.Capabilities = []string{}
		}
		out = append(out, v)
	}
	return out, nil
}

// ListInstalledAgentSkills returns installed+enabled skills for prompt injection.
func (s *Store) ListInstalledAgentSkills(ctx context.Context, agentID int64) ([]AgentSkillView, error) {
	all, err := s.ListAgentSkills(ctx, agentID)
	if err != nil {
		return nil, err
	}
	var out []AgentSkillView
	for _, sk := range all {
		if sk.Installed && sk.Enabled {
			out = append(out, sk)
		}
	}
	return out, nil
}

// InstallAgentSkill installs or updates a skill for an agent.
func (s *Store) InstallAgentSkill(ctx context.Context, agentID int64, skillID, installedBy string, caps []string) error {
	skill, err := s.GetSkillCatalog(ctx, skillID)
	if err != nil {
		return err
	}
	if !skill.Enabled {
		return fmt.Errorf("skill disabled")
	}
	if caps == nil {
		caps = defaultCapabilityIDs(skill.Capabilities)
	} else {
		caps = NormalizeCapabilities(caps, skill.Capabilities)
	}
	raw, _ := json.Marshal(caps)
	res, err := s.db.ExecContext(ctx, `
INSERT INTO agent_skill_installs (agent_id, skill_id, enabled, enabled_capabilities_json, installed_by)
VALUES (?, ?, 1, CAST(? AS JSON), ?)
ON DUPLICATE KEY UPDATE
  enabled=1,
  enabled_capabilities_json=VALUES(enabled_capabilities_json),
  installed_by=VALUES(installed_by),
  updated_at=CURRENT_TIMESTAMP(3)`, agentID, skillID, string(raw), nullIfEmpty(installedBy))
	if err != nil {
		return err
	}
	aff, _ := res.RowsAffected()
	// MySQL: insert=1, update same values=0, update changed=2
	if aff == 1 {
		_, _ = s.db.ExecContext(ctx, `UPDATE skill_catalog SET install_count=install_count+1 WHERE id=?`, skillID)
	}
	return nil
}

// UpdateAgentSkillInstall patches enabled flag and/or capabilities.
func (s *Store) UpdateAgentSkillInstall(ctx context.Context, agentID int64, skillID string, enabled *bool, caps []string) error {
	skill, err := s.GetSkillCatalog(ctx, skillID)
	if err != nil {
		return err
	}
	var sets []string
	var args []any
	if enabled != nil {
		en := 0
		if *enabled {
			en = 1
		}
		sets = append(sets, "enabled=?")
		args = append(args, en)
	}
	if caps != nil {
		norm := NormalizeCapabilities(caps, skill.Capabilities)
		raw, _ := json.Marshal(norm)
		sets = append(sets, "enabled_capabilities_json=CAST(? AS JSON)")
		args = append(args, string(raw))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, agentID, skillID)
	q := `UPDATE agent_skill_installs SET ` + strings.Join(sets, ", ") + `, updated_at=CURRENT_TIMESTAMP(3) WHERE agent_id=? AND skill_id=?`
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// UninstallAgentSkill removes a skill install.
func (s *Store) UninstallAgentSkill(ctx context.Context, agentID int64, skillID string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM agent_skill_installs WHERE agent_id=? AND skill_id=?`, agentID, skillID)
	if err != nil {
		return err
	}
	aff, _ := res.RowsAffected()
	if aff > 0 {
		_, _ = s.db.ExecContext(ctx, `UPDATE skill_catalog SET install_count=GREATEST(install_count-1,0) WHERE id=?`, skillID)
	}
	return nil
}

// CreateCustomSkill inserts a user-published custom skill.
func (s *Store) CreateCustomSkill(ctx context.Context, item SkillCatalogItem) (SkillCatalogItem, error) {
	if item.ID == "" {
		item.ID = "custom." + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	if item.IconKey == "" {
		item.IconKey = "custom"
	}
	if item.Category == "" {
		item.Category = "custom"
	}
	if item.Risk == "" {
		item.Risk = "mid"
	}
	if item.Author == "" {
		item.Author = item.PublisherName
	}
	if item.Version == "" {
		item.Version = "1.0.0"
	}
	if item.Rules == nil {
		item.Rules = []SkillRule{}
	}
	if item.Capabilities == nil {
		item.Capabilities = []SkillCapability{{ID: "prompt.only", Label: "提示约束", DefaultOn: true}}
	}
	item.Source = "custom"
	item.Enabled = true
	rulesJSON, _ := json.Marshal(item.Rules)
	capsJSON, _ := json.Marshal(item.Capabilities)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO skill_catalog (
  id, name, summary, description, icon_key, icon_url, source, publisher_id, publisher_name, author, category, risk,
  rules_json, capabilities_json, version, enabled
) VALUES (?, ?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 1)`,
		item.ID, item.Name, item.Summary, item.Description, item.IconKey, nullIfEmpty(item.IconURL),
		nullIfEmpty(item.PublisherID), nullIfEmpty(item.PublisherName), item.Author, item.Category, item.Risk,
		string(rulesJSON), string(capsJSON), item.Version,
	)
	if err != nil {
		return item, err
	}
	return s.GetSkillCatalog(ctx, item.ID)
}

// NormalizeCapabilities keeps only ids present in available.
func NormalizeCapabilities(want []string, available []SkillCapability) []string {
	allow := map[string]bool{}
	for _, c := range available {
		allow[c.ID] = true
	}
	var out []string
	seen := map[string]bool{}
	for _, id := range want {
		id = strings.TrimSpace(id)
		if id == "" || !allow[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func defaultCapabilityIDs(caps []SkillCapability) []string {
	var out []string
	for _, c := range caps {
		if c.DefaultOn {
			out = append(out, c.ID)
		}
	}
	return out
}

// FormatInstalledSkillsPrompt builds a compact system-prompt block for installed skills.
// Database skill is intentionally omitted here — callers inject FormatDBSourcesPromptCompact separately.
func FormatInstalledSkillsPrompt(skills []AgentSkillView) string {
	if len(skills) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Skills\n")
	for _, sk := range skills {
		if sk.ID == "atolla.database" || sk.ID == "atolla.server_control" {
			continue // compact blocks appended by service
		}
		// One line per skill to save tokens.
		b.WriteString("- ")
		b.WriteString(sk.ID)
		if len(sk.Capabilities) > 0 {
			b.WriteString(" [")
			b.WriteString(strings.Join(sk.Capabilities, ","))
			b.WriteString("]")
		}
		if sk.Summary != "" {
			b.WriteString(": ")
			b.WriteString(sk.Summary)
		}
		b.WriteByte('\n')
		for _, r := range sk.Rules {
			if strings.EqualFold(r.Type, "deny") {
				b.WriteString("  !")
				b.WriteString(r.Text)
				b.WriteByte('\n')
			}
		}
	}
	out := strings.TrimRight(b.String(), "\n")
	if out == "## Skills" {
		return ""
	}
	return out
}

// AgentHasSkillCapability reports whether an agent has a capability via installed skills.
func (s *Store) AgentHasSkillCapability(ctx context.Context, agentID int64, capabilityID string) (bool, error) {
	skills, err := s.ListInstalledAgentSkills(ctx, agentID)
	if err != nil {
		return false, err
	}
	for _, sk := range skills {
		for _, c := range sk.Capabilities {
			if c == capabilityID {
				return true, nil
			}
		}
	}
	return false, nil
}

// SyncEngineFlagsFromSkills maps installed engine skill caps onto allow_* flags.
func SyncEngineFlagsFromSkills(skills []AgentSkillView, a *ManagedAgent) {
	if a == nil {
		return
	}
	has := map[string]bool{}
	for _, sk := range skills {
		if !sk.Installed || !sk.Enabled {
			continue
		}
		for _, c := range sk.Capabilities {
			has[c] = true
		}
	}
	// Only override when corresponding skill is present in the installed set at all.
	installedIDs := map[string]bool{}
	for _, sk := range skills {
		if sk.Installed {
			installedIDs[sk.ID] = true
		}
	}
	if installedIDs["atolla.coding"] {
		a.AllowWrite = has["engine.write"]
	}
	if installedIDs["atolla.search"] {
		a.AllowNetwork = has["engine.web_search"]
	}
	// 浏览器权限仅由技能控制：安装开启，卸载关闭（不再走设置开关）
	a.AllowBrowser = installedIDs["atolla.browser"] && has["engine.browser"]
}
