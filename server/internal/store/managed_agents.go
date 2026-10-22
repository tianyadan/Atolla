package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// ManagedAgent 管理台注册的数字员工（API/表名仍为 agent）。
type ManagedAgent struct {
	ID                  int64                 `json:"id"`
	Name                string                `json:"name"`
	AvatarURL           string                `json:"avatar_url"`
	JellyColor          string                `json:"jelly_color"` // 像素小水母颜色
	FolderID            int64                 `json:"folder_id"`   // 0=根目录
	Engine              string                `json:"engine"`
	ContextWindowTokens int64                 `json:"context_window_tokens"` // claude | codex | agent
	BinPath             string                `json:"bin_path"`
	RulesPrompt         string                `json:"rules_prompt"`
	AutoReview          bool                  `json:"auto_review"`
	AutoApproveAll      bool                  `json:"auto_approve_all"`  // 命令全部审批通过（无需人工）
	TaskPlanEnabled     bool                  `json:"task_plan_enabled"` // 默认 true：Ask 前 AI 拆分步骤
	AllowWrite          bool                  `json:"allow_write"`
	AllowNetwork        bool                  `json:"allow_network"`
	AllowRm             bool                  `json:"allow_rm"`
	AllowBrowser        bool                  `json:"allow_browser"`
	WorkspacePath       string                `json:"workspace_path"`
	ScheduleEnabled     bool                  `json:"schedule_enabled"`
	ScheduleCron        string                `json:"schedule_cron"`
	ScheduleLabel       string                `json:"schedule_label"`
	Status              string                `json:"status"`
	IsReceptionist      bool                  `json:"is_receptionist"`
	ConversationID      int64                 `json:"conversation_id"`
	ClonedFromID        int64                 `json:"cloned_from_id"`
	FolderName          string                `json:"folder_name,omitempty"` // 列表展示用，非列
	SkillCount          int                   `json:"skill_count"`           // 已安装技能数（列表富化）
	SkillIcons          []AgentSkillIconBrief `json:"skill_icons,omitempty"` // 悬停展示用
	LastError           string                `json:"last_error"`
	LastRunMs           int                   `json:"last_run_ms"`
	TaskUnread          bool                  `json:"task_unread"` // 任务完成待查看
	RunStartedAt        *time.Time            `json:"run_started_at,omitempty"`
	CreatedAt           time.Time             `json:"created_at"`
	UpdatedAt           time.Time             `json:"updated_at"`
}

// ManagedAgentInput 招聘/更新数字员工入参。
type ManagedAgentInput struct {
	Name                string
	Engine              string
	ContextWindowTokens *int64
	BinPath             string
	RulesPrompt         string
	AllowWrite          *bool
	AllowNetwork        *bool
	AllowRm             *bool
	AllowBrowser        *bool
	WorkspacePath       *string
	ScheduleEnabled     *bool
	ScheduleCron        *string
	ScheduleLabel       *string
	JellyColor          *string // 创建：nil=按 id 自动分配；更新：nil=不改
}

// ValidContextWindow 只接受后台提供的三档窗口（Token 数）。
func ValidContextWindow(v int64) bool { return v == 262144 || v == 524288 || v == 1000000 }

func DefaultContextWindow(engine string) int64 {
	if strings.EqualFold(engine, "claude") {
		return 1000000
	}
	return 262144
}

// ValidEngine 校验引擎类型。
func ValidEngine(e string) bool {
	switch RepairEngineName(e) {
	case "claude", "codex", "agent":
		return true
	default:
		return false
	}
}

// DefaultBin 返回引擎默认二进制名。
func DefaultBin(engine string) string {
	switch RepairEngineName(engine) {
	case "claude":
		return "claude"
	case "codex":
		return "codex"
	case "agent":
		return "agent"
	default:
		return ""
	}
}

// SanitizeExecToken 去掉 NUL/控制字符并拷贝，避免脏内存把 "agent" 变成 "\x00gent"。
func SanitizeExecToken(s string) string {
	if s == "" {
		return ""
	}
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == 0 || c < 0x20 {
			continue
		}
		b = append(b, c)
	}
	return strings.TrimSpace(string(b))
}

// RepairEngineName 纠正引擎名首字节损坏（如 "\x00gent"→"agent"）。
func RepairEngineName(engine string) string {
	eng := strings.ToLower(SanitizeExecToken(engine))
	if eng == "" {
		return ""
	}
	for _, known := range []string{"claude", "codex", "agent"} {
		if eng == known {
			return known
		}
		// 首字节丢失后的后缀仍可认回。
		if len(eng) >= 3 && strings.HasSuffix(known, eng) {
			return known
		}
	}
	return eng
}

// ResolveEngineBin 解析可执行引擎路径。裸命令名若被损坏（如 gent），回退到 DefaultBin。
func ResolveEngineBin(engine, binPath string) string {
	eng := RepairEngineName(engine)
	bin := SanitizeExecToken(binPath)
	def := DefaultBin(eng)
	if bin == "" {
		if def != "" {
			return def
		}
		// 引擎字段也坏了时，尝试从 bin 残片认回。
		if repaired := RepairEngineName(binPath); repaired == "claude" || repaired == "codex" || repaired == "agent" {
			return repaired
		}
		return ""
	}
	// 自定义路径（含目录分隔）保留清理后的值。
	if strings.ContainsAny(bin, `/\`) {
		return bin
	}
	// 已知引擎：裸命令名一律用默认二进制，避免 "\x00gent"→"gent" 直接拿去 exec。
	if def != "" {
		return def
	}
	if repaired := RepairEngineName(bin); repaired == "claude" || repaired == "codex" || repaired == "agent" {
		return repaired
	}
	return bin
}

func bool01(b bool) int {
	if b {
		return 1
	}
	return 0
}

// scanManagedAgent 扫描一行 managed_agents。
func scanManagedAgent(scanner interface {
	Scan(dest ...any) error
}) (ManagedAgent, error) {
	var a ManagedAgent
	var runAt sql.NullTime
	var auto, aaa, tp, aw, an, ar, ab, se, recv, unread int
	err := scanner.Scan(
		&a.ID, &a.Name, &a.AvatarURL, &a.JellyColor, &a.FolderID, &a.Engine, &a.ContextWindowTokens, &a.BinPath, &a.RulesPrompt, &auto, &aaa, &tp,
		&aw, &an, &ar, &ab, &a.WorkspacePath, &se, &a.ScheduleCron, &a.ScheduleLabel,
		&a.Status, &recv, &a.ConversationID, &a.ClonedFromID, &a.LastError, &a.LastRunMs, &unread, &runAt, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return a, err
	}
	a.AutoReview = auto != 0
	a.AutoApproveAll = aaa != 0
	a.TaskPlanEnabled = tp != 0
	a.AllowWrite = aw != 0
	a.AllowNetwork = an != 0
	a.AllowRm = ar != 0
	a.AllowBrowser = ab != 0
	a.ScheduleEnabled = se != 0
	a.IsReceptionist = recv != 0
	a.TaskUnread = unread != 0
	// 兼容旧行或异常空值：读出时补齐稳定默认色。
	if a.JellyColor == "" || !ValidJellyColor(a.JellyColor) {
		a.JellyColor = AssignJellyColor(a.ID)
	} else {
		a.JellyColor = NormalizeJellyColor(a.JellyColor)
	}
	if runAt.Valid {
		t := runAt.Time
		a.RunStartedAt = &t
	}
	return a, nil
}

const managedSelectCols = `id, name, IFNULL(avatar_url,''), IFNULL(jelly_color,''), IFNULL(folder_id,0), engine, context_window_tokens, bin_path, IFNULL(rules_prompt,''), IFNULL(auto_review,0),
		IFNULL(auto_approve_all,0), IFNULL(task_plan_enabled,1),
		IFNULL(allow_write,1), IFNULL(allow_network,1), IFNULL(allow_rm,0), IFNULL(allow_browser,0), IFNULL(workspace_path,''),
		IFNULL(schedule_enabled,0), IFNULL(schedule_cron,''), IFNULL(schedule_label,''),
		status, IFNULL(is_receptionist,0), IFNULL(conversation_id,0), IFNULL(cloned_from_id,0), IFNULL(last_error,''), IFNULL(last_run_ms,0),
		IFNULL(task_unread,0), run_started_at, created_at, updated_at`

// ListManagedAgents 全部数字员工(最新更新在前)。
func (s *Store) ListManagedAgents(ctx context.Context) ([]ManagedAgent, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+managedSelectCols+` FROM managed_agents ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ManagedAgent
	for rows.Next() {
		a, err := scanManagedAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListScheduledAgents 已开启定时的数字员工。
func (s *Store) ListScheduledAgents(ctx context.Context) ([]ManagedAgent, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+managedSelectCols+` FROM managed_agents
		 WHERE IFNULL(schedule_enabled,0)=1 AND IFNULL(schedule_cron,'')<>''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ManagedAgent
	for rows.Next() {
		a, err := scanManagedAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetManagedAgent 按 id 取一条。
func (s *Store) GetManagedAgent(ctx context.Context, id int64) (*ManagedAgent, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+managedSelectCols+` FROM managed_agents WHERE id=?`, id)
	a, err := scanManagedAgent(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// CreateManagedAgent 招聘数字员工(含权限策略)。
func (s *Store) CreateManagedAgent(ctx context.Context, in ManagedAgentInput) (int64, error) {
	engine := strings.ToLower(strings.TrimSpace(in.Engine))
	binPath := strings.TrimSpace(in.BinPath)
	if binPath == "" {
		binPath = DefaultBin(engine)
	}
	aw, an, ar, ab := true, true, false, false
	if in.AllowWrite != nil {
		aw = *in.AllowWrite
	}
	if in.AllowNetwork != nil {
		an = *in.AllowNetwork
	}
	if in.AllowRm != nil {
		ar = *in.AllowRm
	}
	if in.AllowBrowser != nil {
		ab = *in.AllowBrowser
	}
	ws, cron, label := "", "", ""
	se := false
	if in.WorkspacePath != nil {
		ws = strings.TrimSpace(*in.WorkspacePath)
	}
	if in.ScheduleEnabled != nil {
		se = *in.ScheduleEnabled
	}
	if in.ScheduleCron != nil {
		cron = strings.TrimSpace(*in.ScheduleCron)
	}
	if in.ScheduleLabel != nil {
		label = strings.TrimSpace(*in.ScheduleLabel)
	}
	window := DefaultContextWindow(engine)
	if in.ContextWindowTokens != nil {
		window = *in.ContextWindowTokens
	}
	// 创建时先写入占位色，拿到 id 后再按规则解析/回填，保证自动分配稳定。
	explicit := ""
	if in.JellyColor != nil {
		explicit = *in.JellyColor
		if NormalizeJellyColor(explicit) == "" {
			return 0, ErrInvalidJellyColor
		}
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO managed_agents
		 (name, jelly_color, engine, context_window_tokens, bin_path, rules_prompt, status, allow_write, allow_network, allow_rm, allow_browser,
		  workspace_path, schedule_enabled, schedule_cron, schedule_label)
		 VALUES (?,?,?,?,?,?, 'idle',?,?,?,?,?,?,?,?)`,
		in.Name, JellyColors[0], engine, window, binPath, in.RulesPrompt,
		bool01(aw), bool01(an), bool01(ar), bool01(ab), ws, bool01(se), cron, label)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	color, err := ResolveJellyColor(id, explicit)
	if err != nil {
		return 0, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET jelly_color=? WHERE id=?`, color, id); err != nil {
		return 0, err
	}
	return id, nil
}

// InsertClonedManagedAgent 插入复制员工（不定时任务；status 由调用方给定）。
func (s *Store) InsertClonedManagedAgent(ctx context.Context, a ManagedAgent) (int64, error) {
	engine := strings.ToLower(strings.TrimSpace(a.Engine))
	binPath := strings.TrimSpace(a.BinPath)
	if binPath == "" {
		binPath = DefaultBin(engine)
	}
	st := strings.TrimSpace(a.Status)
	if st == "" {
		st = "idle"
	}
	var folder any
	if a.FolderID > 0 {
		folder = a.FolderID
	}
	var cloned any
	if a.ClonedFromID > 0 {
		cloned = a.ClonedFromID
	}
	// 复制员工：显式色优先，否则插入后再按新 id 自动分配（不继承源色，便于同组分散）。
	explicit := strings.TrimSpace(a.JellyColor)
	if explicit != "" && NormalizeJellyColor(explicit) == "" {
		return 0, ErrInvalidJellyColor
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO managed_agents
		 (name, avatar_url, jelly_color, folder_id, engine, context_window_tokens, bin_path, rules_prompt, auto_review, task_plan_enabled,
		  allow_write, allow_network, allow_rm, allow_browser, workspace_path,
		  schedule_enabled, schedule_cron, schedule_label, status, conversation_id, cloned_from_id)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.Name, nullIfEmpty(a.AvatarURL), JellyColors[0], folder, engine, a.ContextWindowTokens, binPath, a.RulesPrompt,
		bool01(a.AutoReview), bool01(a.TaskPlanEnabled),
		bool01(a.AllowWrite), bool01(a.AllowNetwork), bool01(a.AllowRm), bool01(a.AllowBrowser),
		a.WorkspacePath, 0, "", "", st, nil, cloned)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	color, err := ResolveJellyColor(id, explicit)
	if err != nil {
		return 0, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET jelly_color=? WHERE id=?`, color, id); err != nil {
		return 0, err
	}
	return id, nil
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// UpdateManagedAgent 更新数字员工;in 中指针字段非 nil 才覆盖,Name/BinPath/RulesPrompt 用 Has* 由 handler 填满后直接写。
// 约定:handler 保存设置时传入完整合并后的 Name/BinPath/RulesPrompt 与全部策略指针。
func (s *Store) UpdateManagedAgent(ctx context.Context, id int64, in ManagedAgentInput) error {
	a, err := s.GetManagedAgent(ctx, id)
	if err != nil || a == nil {
		if a == nil && err == nil {
			return sql.ErrNoRows
		}
		return err
	}
	n, b, r := a.Name, a.BinPath, a.RulesPrompt
	aw, an, ar, ab := a.AllowWrite, a.AllowNetwork, a.AllowRm, a.AllowBrowser
	ws, se, cron, label := a.WorkspacePath, a.ScheduleEnabled, a.ScheduleCron, a.ScheduleLabel
	window := a.ContextWindowTokens
	if in.ContextWindowTokens != nil {
		window = *in.ContextWindowTokens
	}

	if strings.TrimSpace(in.Name) != "" {
		n = strings.TrimSpace(in.Name)
	}
	if strings.TrimSpace(in.BinPath) != "" {
		b = strings.TrimSpace(in.BinPath)
	}
	// RulesPrompt: 用策略指针非空作为「完整设置保存」标记,允许清空规则
	if in.AllowWrite != nil || in.AllowNetwork != nil || in.AllowRm != nil || in.AllowBrowser != nil || in.WorkspacePath != nil || in.ScheduleEnabled != nil {
		r = in.RulesPrompt
	} else if in.RulesPrompt != "" {
		r = in.RulesPrompt
	}
	if in.AllowWrite != nil {
		aw = *in.AllowWrite
	}
	if in.AllowNetwork != nil {
		an = *in.AllowNetwork
	}
	if in.AllowRm != nil {
		ar = *in.AllowRm
	}
	if in.AllowBrowser != nil {
		ab = *in.AllowBrowser
	}
	if in.WorkspacePath != nil {
		ws = strings.TrimSpace(*in.WorkspacePath)
	}
	if in.ScheduleEnabled != nil {
		se = *in.ScheduleEnabled
	}
	if in.ScheduleCron != nil {
		cron = strings.TrimSpace(*in.ScheduleCron)
	}
	if in.ScheduleLabel != nil {
		label = strings.TrimSpace(*in.ScheduleLabel)
	}
	jelly := a.JellyColor
	if in.JellyColor != nil {
		jelly = NormalizeJellyColor(*in.JellyColor)
		if jelly == "" {
			return ErrInvalidJellyColor
		}
	}

	_, err = s.db.ExecContext(ctx,
		`UPDATE managed_agents SET name=?, jelly_color=?, context_window_tokens=?, bin_path=?, rules_prompt=?,
		 allow_write=?, allow_network=?, allow_rm=?, allow_browser=?, workspace_path=?,
		 schedule_enabled=?, schedule_cron=?, schedule_label=? WHERE id=?`,
		n, jelly, window, b, r, bool01(aw), bool01(an), bool01(ar), bool01(ab), ws, bool01(se), cron, label, id)
	return err
}

// SetManagedAgentJellyColor 单独更新像素小水母颜色。
func (s *Store) SetManagedAgentJellyColor(ctx context.Context, id int64, color string) error {
	color = NormalizeJellyColor(color)
	if color == "" {
		return ErrInvalidJellyColor
	}
	res, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET jelly_color=? WHERE id=?`, color, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetManagedAgentTaskPlan 持久化任务规划开关（默认开）。
func (s *Store) SetManagedAgentTaskPlan(ctx context.Context, id int64, enabled bool) error {
	res, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET task_plan_enabled=? WHERE id=?`, bool01(enabled), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetManagedAgentAutoReview 持久化 AI 自动审核开关。
func (s *Store) SetManagedAgentAutoReview(ctx context.Context, id int64, enabled bool) error {
	res, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET auto_review=? WHERE id=?`, bool01(enabled), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetManagedAgentAutoApproveAll 持久化「命令全部审批通过」开关。
func (s *Store) SetManagedAgentAutoApproveAll(ctx context.Context, id int64, enabled bool) error {
	res, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET auto_approve_all=? WHERE id=?`, bool01(enabled), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// CountUserMessages 会话中 user 消息数。
func (s *Store) CountUserMessages(ctx context.Context, conversationID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM messages WHERE conversation_id=? AND role='user'`, conversationID).Scan(&n)
	return n, err
}

// DeleteManagedAgent 解聘数字员工及其会话消息。
func (s *Store) DeleteManagedAgent(ctx context.Context, id int64) error {
	a, err := s.GetManagedAgent(ctx, id)
	if err != nil {
		return err
	}
	if a == nil {
		return sql.ErrNoRows
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 先清群聊成员，避免测试/解聘后残留挂在 group_chat_members
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_chat_members WHERE agent_id=?`, id); err != nil {
		return err
	}
	if a.ConversationID > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM conversations WHERE id=?`, a.ConversationID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversations WHERE agent_id=?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM managed_agents WHERE id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// SetManagedAgentStatus 更新运行状态。
// running / compressing 视为工作中：保留已有 run_started_at，否则置 NOW()；结束态清空时钟并写 last_run_ms。
// 从忙碌态落到 idle/error 时自动置 task_unread=1（查看对话后清除）。
func (s *Store) SetManagedAgentStatus(ctx context.Context, id int64, status, lastErr string, runMs int, convID int64) error {
	if status == "running" || status == "compressing" {
		_, err := s.db.ExecContext(ctx,
			`UPDATE managed_agents SET status=?, last_error=?, last_run_ms=?,
			 run_started_at=IFNULL(run_started_at, NOW()),
			 conversation_id=IFNULL(NULLIF(?,0), conversation_id) WHERE id=?`,
			status, lastErr, runMs, convID, id)
		return err
	}
	// MySQL：同一 UPDATE 中右侧的 status 仍是旧值，可据此判断「忙→闲」打未读
	_, err := s.db.ExecContext(ctx,
		`UPDATE managed_agents SET status=?, last_error=?, last_run_ms=?, run_started_at=NULL,
		 conversation_id=IFNULL(NULLIF(?,0), conversation_id),
		 task_unread = IF(
		   status IN ('running','busy','waiting','插话中','compressing') AND ? IN ('idle','error'),
		   1, IFNULL(task_unread,0)
		 )
		 WHERE id=?`,
		status, lastErr, runMs, convID, status, id)
	return err
}

// ClearManagedAgentTaskUnread 清除任务完成未读（PC / 移动 / 灵动岛查看时调用）。
func (s *Store) ClearManagedAgentTaskUnread(ctx context.Context, id int64) error {
	if id <= 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET task_unread=0 WHERE id=? AND IFNULL(task_unread,0)<>0`, id)
	return err
}

// EnsureTaskUnreadSchema 幂等增加 task_unread 列。
func (s *Store) EnsureTaskUnreadSchema(ctx context.Context) error {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'managed_agents' AND COLUMN_NAME = 'task_unread'`,
	).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx,
		`ALTER TABLE managed_agents ADD COLUMN task_unread TINYINT NOT NULL DEFAULT 0 AFTER last_run_ms`)
	return err
}

// ManagedAgentStatusByConversation 按会话反查数字员工 id 与当前 status（无则 0）。
func (s *Store) ManagedAgentStatusByConversation(ctx context.Context, convID int64) (agentID int64, status string, err error) {
	if convID <= 0 {
		return 0, "", nil
	}
	err = s.db.QueryRowContext(ctx,
		`SELECT id, IFNULL(status,'idle') FROM managed_agents WHERE conversation_id=? LIMIT 1`, convID).
		Scan(&agentID, &status)
	if err == sql.ErrNoRows {
		return 0, "", nil
	}
	return agentID, status, err
}

// SetManagedAgentAvatarURL 更新头像 URL（空字符串清空）。
func (s *Store) SetManagedAgentAvatarURL(ctx context.Context, id int64, url string) error {
	url = strings.TrimSpace(url)
	var v any
	if url == "" {
		v = nil
	} else {
		v = url
	}
	res, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET avatar_url=? WHERE id=?`, v, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetManagedAgentConversation 绑定当前会话。
func (s *Store) SetManagedAgentConversation(ctx context.Context, id, convID int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE managed_agents SET conversation_id=? WHERE id=?`, convID, id)
	return err
}

// CreateAgentConversation 为数字员工新建 chat 会话。
func (s *Store) CreateAgentConversation(ctx context.Context, agentID int64) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO conversations (user_ip, mode, agent_id) VALUES (?,?,?)`,
		"admin", "chat", agentID)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ClearConversationMessages 清空会话全部消息。
func (s *Store) ClearConversationMessages(ctx context.Context, conversationID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM messages WHERE conversation_id=?`, conversationID)
	return err
}

// AgentTasksByAgentID 按 agent_id 过滤任务(可空 agentType)。
func (s *Store) AgentTasksByAgentID(ctx context.Context, agentType, agentID, status string) ([]AgentTask, error) {
	q := `SELECT id, agent_type, agent_id, task_id, task_name, status, progress, IFNULL(message,''), IFNULL(payload,'null'), created_at, updated_at
	      FROM agent_tasks WHERE 1=1`
	args := []interface{}{}
	if agentType != "" {
		q += ` AND agent_type=?`
		args = append(args, agentType)
	}
	if agentID != "" {
		q += ` AND agent_id=?`
		args = append(args, agentID)
	}
	if status != "" {
		q += ` AND status=?`
		args = append(args, status)
	}
	q += ` ORDER BY updated_at DESC LIMIT 200`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentTask
	for rows.Next() {
		var t AgentTask
		var payload []byte
		if err := rows.Scan(&t.ID, &t.AgentType, &t.AgentID, &t.TaskID, &t.TaskName, &t.Status, &t.Progress, &t.Message, &payload, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		if len(payload) > 0 {
			_ = json.Unmarshal(payload, &t.Payload)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
