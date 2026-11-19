package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// 数字员工 Ask 审计状态（终态；processing 仅中间态）。
const (
	AgentAskStatusProcessing  = "processing"
	AgentAskStatusCompleted   = "completed"
	AgentAskStatusFailed      = "failed"
	AgentAskStatusTimeout     = "timeout"
	AgentAskStatusCancelled   = "cancelled"
	AgentAskStatusInterrupted = "interrupted"
)

// 审计来源。
const (
	AgentAskSourceAdmin  = "admin"
	AgentAskSourceMobile = "mobile"
)

// 工具调用结果。
const (
	AgentAskToolOK     = "ok"
	AgentAskToolError  = "error"
	AgentAskToolDenied = "denied"
)

const agentLLMTraceRetention = 7 * 24 * time.Hour

// AgentLLMInvocation 是一次 CLI 可观测调用轨迹，不冒充 CLI 内部真实模型 API 请求。
type AgentLLMInvocation struct {
	ID               int64      `json:"id"`
	AskLogID         int64      `json:"ask_log_id"`
	AgentID          int64      `json:"agent_id"`
	StepNo           int        `json:"step_no"`
	Engine           string     `json:"engine"`
	Source           string     `json:"source"`
	Model            string     `json:"model"`
	Status           string     `json:"status"`
	DurationMs       int        `json:"duration_ms"`
	InputTokens      int64      `json:"input_tokens"`
	OutputTokens     int64      `json:"output_tokens"`
	CacheTokens      int64      `json:"cache_tokens"`
	ContextWindow    int64      `json:"context_window"`
	ContextUsed      int64      `json:"context_used"`
	InputContent     string     `json:"input_content"`
	OutputContent    string     `json:"output_content"`
	InputTruncated   bool       `json:"input_truncated"`
	OutputTruncated  bool       `json:"output_truncated"`
	AvailabilityNote string     `json:"availability_note"`
	StartedAt        time.Time  `json:"started_at"`
	FinishedAt       *time.Time `json:"finished_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// AgentAskLog 数字员工一轮 Ask。
type AgentAskLog struct {
	ID             int64  `json:"id"`
	AgentID        int64  `json:"agent_id"`
	ConversationID int64  `json:"conversation_id"`
	UserMessageID  int64  `json:"user_message_id"`
	Source         string `json:"source"`
	// Engine 是任务开始时的引擎快照。不能在完成时读取当前配置，
	// 否则用户中途切换引擎会污染历史 Token 归属。
	Engine       string     `json:"engine"`
	Status       string     `json:"status"`
	DurationMs   int        `json:"duration_ms"`
	InputTokens  int64      `json:"input_tokens"`
	OutputTokens int64      `json:"output_tokens"`
	TotalTokens  int64      `json:"total_tokens"`
	ErrorType    string     `json:"error_type,omitempty"`
	ErrorMessage string     `json:"error_message,omitempty"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// AgentAskToolCall 一轮内的工具调用。
type AgentAskToolCall struct {
	ID         int64     `json:"id"`
	AskLogID   int64     `json:"ask_log_id"`
	AgentID    int64     `json:"agent_id"`
	ToolName   string    `json:"tool_name"`
	Summary    string    `json:"summary,omitempty"`
	Result     string    `json:"result"`
	DurationMs int       `json:"duration_ms"`
	CreatedAt  time.Time `json:"created_at"`
}

// AgentAskRuntimeDetail 单个数字员工最近一轮运行及其工具调用。
type AgentAskRuntimeDetail struct {
	AgentAskLog
	Tools          []AgentAskToolCall   `json:"tools"`
	LLMInvocations []AgentLLMInvocation `json:"llm_invocations"`
}

// AgentAskAuditFilter 聚合查询公共筛选。
type AgentAskAuditFilter struct {
	AgentID int64
	From    time.Time
	To      time.Time
}

// AgentAskOverview 看板概览。
type AgentAskOverview struct {
	TotalRuns     int64                   `json:"total_runs"`
	CompletedRuns int64                   `json:"completed_runs"`
	FailedRuns    int64                   `json:"failed_runs"` // failed + timeout
	TotalTokens   int64                   `json:"total_tokens"`
	AvgDurationMs float64                 `json:"avg_duration_ms"`
	StatusCounts  []AgentAskStatusCount   `json:"status_counts"`
	TopTools      []AgentAskToolAggregate `json:"top_tools"`
}

// AgentAskStatusCount 某一终态次数。
type AgentAskStatusCount struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

// AgentAskTokenBucket 按日/周的 Token。
type AgentAskTokenBucket struct {
	Bucket       string `json:"bucket"` // 日期 YYYY-MM-DD 或周一起点
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	TotalTokens  int64  `json:"total_tokens"`
}

// ProfileTokenUsageDay 是长期保留的个人 Token 用量日汇总。
// 它只包含聚合数字和引擎，不保存 Prompt、回答或工具参数。
type ProfileTokenUsageDay struct {
	Date        string `json:"date"`
	TotalTokens int64  `json:"total_tokens"`
	Estimated   bool   `json:"estimated"`
}

// AgentAskToolAggregate 按工具聚合。
type AgentAskToolAggregate struct {
	ToolName      string  `json:"tool_name"`
	CallCount     int64   `json:"call_count"`
	OkCount       int64   `json:"ok_count"`
	ErrorCount    int64   `json:"error_count"`
	DeniedCount   int64   `json:"denied_count"`
	AvgDurationMs float64 `json:"avg_duration_ms"`
}

// AgentAskErrorRow 最近错误。
type AgentAskErrorRow struct {
	ID           int64     `json:"id"`
	AgentID      int64     `json:"agent_id"`
	AgentName    string    `json:"agent_name"`
	Status       string    `json:"status"`
	ErrorType    string    `json:"error_type"`
	ErrorMessage string    `json:"error_message"`
	CreatedAt    time.Time `json:"created_at"`
}

// ensureAgentAskAuditSchema 创建数字员工审计表。
func (s *Store) ensureAgentAskAuditSchema(ctx context.Context) error {
	usageTableExists, err := s.hasTable(ctx, "agent_token_usage_records")
	if err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS agent_ask_logs (
		  id                BIGINT        NOT NULL AUTO_INCREMENT,
		  agent_id          BIGINT        NOT NULL,
		  conversation_id   BIGINT        NOT NULL DEFAULT 0,
		  user_message_id   BIGINT        NOT NULL DEFAULT 0,
		  source            VARCHAR(16)   NOT NULL DEFAULT 'admin',
		  engine            VARCHAR(32)   NOT NULL DEFAULT 'unknown',
		  status            VARCHAR(20)   NOT NULL DEFAULT 'processing',
		  duration_ms       INT           NOT NULL DEFAULT 0,
		  input_tokens      BIGINT        NOT NULL DEFAULT 0,
		  output_tokens     BIGINT        NOT NULL DEFAULT 0,
		  total_tokens      BIGINT        NOT NULL DEFAULT 0,
		  error_type        VARCHAR(64)   NOT NULL DEFAULT '',
		  error_message     TEXT          NULL,
		  started_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  finished_at       DATETIME      NULL,
		  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  KEY idx_aal_agent_started (agent_id, started_at),
		  KEY idx_aal_started (started_at),
		  KEY idx_aal_status_started (status, started_at)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS agent_ask_tool_calls (
		  id           BIGINT       NOT NULL AUTO_INCREMENT,
		  ask_log_id   BIGINT       NOT NULL,
		  agent_id     BIGINT       NOT NULL,
		  tool_name    VARCHAR(128) NOT NULL DEFAULT '',
		  result       VARCHAR(16)  NOT NULL DEFAULT 'ok',
		  duration_ms  INT          NOT NULL DEFAULT 0,
		  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  KEY idx_aatc_ask (ask_log_id),
		  KEY idx_aatc_agent_tool (agent_id, tool_name),
		  KEY idx_aatc_agent_time (agent_id, created_at)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS agent_llm_invocations (
		  id                BIGINT        NOT NULL AUTO_INCREMENT,
		  ask_log_id        BIGINT        NOT NULL,
		  agent_id          BIGINT        NOT NULL,
		  step_no           INT           NOT NULL DEFAULT 1,
		  engine            VARCHAR(32)   NOT NULL DEFAULT '',
		  source            VARCHAR(64)   NOT NULL DEFAULT 'Atolla Derived',
		  model             VARCHAR(128)  NOT NULL DEFAULT '',
		  status            VARCHAR(20)   NOT NULL DEFAULT 'running',
		  duration_ms       INT           NOT NULL DEFAULT 0,
		  input_tokens      BIGINT        NOT NULL DEFAULT 0,
		  output_tokens     BIGINT        NOT NULL DEFAULT 0,
		  cache_tokens      BIGINT        NOT NULL DEFAULT 0,
		  context_window    BIGINT        NOT NULL DEFAULT 0,
		  context_used      BIGINT        NOT NULL DEFAULT 0,
		  input_content     MEDIUMTEXT    NULL,
		  output_content    MEDIUMTEXT    NULL,
		  input_truncated   TINYINT       NOT NULL DEFAULT 0,
		  output_truncated  TINYINT       NOT NULL DEFAULT 0,
		  availability_note VARCHAR(512)  NOT NULL DEFAULT '',
		  started_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  finished_at       DATETIME      NULL,
		  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  KEY idx_ali_ask_step (ask_log_id, step_no),
		  KEY idx_ali_agent_time (agent_id, created_at),
		  KEY idx_ali_created (created_at)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	// 旧库没有 engine 列；启动时幂等补齐，避免要求用户手工执行迁移。
	if err := s.addColumnIfMissing(ctx, "agent_ask_logs", "engine",
		`ALTER TABLE agent_ask_logs ADD COLUMN engine VARCHAR(32) NOT NULL DEFAULT 'unknown'`); err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS agent_token_usage_records (
		  ask_log_id     BIGINT       NOT NULL,
		  usage_date     DATE         NOT NULL,
		  engine         VARCHAR(32)  NOT NULL DEFAULT 'unknown',
		  input_tokens   BIGINT       NOT NULL DEFAULT 0,
		  output_tokens  BIGINT       NOT NULL DEFAULT 0,
		  cache_tokens   BIGINT       NOT NULL DEFAULT 0,
		  total_tokens   BIGINT       NOT NULL DEFAULT 0,
		  estimated      TINYINT      NOT NULL DEFAULT 0,
		  recorded_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (ask_log_id),
		  KEY idx_atur_date_engine (usage_date, engine)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	// 仅新建表时执行一次历史回填。之后每次启动不再扫描完整审计表；
	// 新运行的写入由 FinishAgentAskLog 同一事务完成。
	if !usageTableExists {
		// 已完成的历史记录也可用于总量热力图。旧记录没有引擎快照，
		// 仅以当前员工引擎回填，并明确标为 estimated，绝不伪装成精确归属。
		if err := s.backfillProfileTokenUsage(ctx); err != nil {
			return err
		}
	}
	return nil
}

// BeginAgentAskLog 用户消息落库后创建 processing 行。
func (s *Store) BeginAgentAskLog(ctx context.Context, agentID, convID, userMsgID int64, source, engine string) (int64, error) {
	// 轨迹含 Prompt/输出正文，只保留 7 天；清理失败不阻断主任务。
	_, _ = s.PurgeAgentLLMInvocations(ctx, time.Now().Add(-agentLLMTraceRetention))
	source = strings.TrimSpace(source)
	if source == "" {
		source = AgentAskSourceAdmin
	}
	engine = normalizeTokenUsageEngine(engine)
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_ask_logs
		  (agent_id, conversation_id, user_message_id, source, engine, status, started_at)
		VALUES (?,?,?,?,?,?,NOW())`,
		agentID, convID, userMsgID, source, engine, AgentAskStatusProcessing)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// BeginAgentLLMInvocation 创建 CLI 可观测调用轨迹。
func (s *Store) BeginAgentLLMInvocation(ctx context.Context, item AgentLLMInvocation) (int64, error) {
	if item.AskLogID <= 0 || item.AgentID <= 0 {
		return 0, nil
	}
	input, inputTruncated := limitLLMTraceContent(item.InputContent)
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_llm_invocations
		  (ask_log_id, agent_id, step_no, engine, source, model, status,
		   input_content, input_truncated, availability_note, started_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
		item.AskLogID, item.AgentID, item.StepNo, limitString(item.Engine, 32),
		limitString(item.Source, 64), limitString(item.Model, 128), "running",
		input, inputTruncated, limitString(item.AvailabilityNote, 512))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateAgentLLMInvocationUsage 写入引擎实际提供的回合级 Usage。
func (s *Store) UpdateAgentLLMInvocationUsage(ctx context.Context, id, input, output, cache, window, used int64) error {
	if id <= 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE agent_llm_invocations SET input_tokens=?, output_tokens=?, cache_tokens=?,
		  context_window=?, context_used=? WHERE id=?`, input, output, cache, window, used, id)
	return err
}

// FinishAgentLLMInvocation 收口输出、耗时和状态。
func (s *Store) FinishAgentLLMInvocation(ctx context.Context, id int64, status, output string, durationMs int) error {
	if id <= 0 {
		return nil
	}
	if status != "success" && status != "failed" {
		status = "failed"
	}
	if durationMs < 0 {
		durationMs = 0
	}
	content, truncated := limitLLMTraceContent(output)
	_, err := s.db.ExecContext(ctx, `
		UPDATE agent_llm_invocations SET status=?, duration_ms=?, output_content=?,
		  output_truncated=?, finished_at=NOW() WHERE id=?`, status, durationMs, content, truncated, id)
	return err
}

// PurgeAgentLLMInvocations 删除 7 天前的敏感调用正文。
func (s *Store) PurgeAgentLLMInvocations(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM agent_llm_invocations WHERE created_at < ?`, before)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func limitString(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > max {
		return string(runes[:max])
	}
	return value
}

func limitLLMTraceContent(value string) (string, bool) {
	const maxRunes = 128 * 1024
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value, false
	}
	return string(runes[:maxRunes]), true
}

// FinishAgentAskLog 结束一轮审计。
func (s *Store) FinishAgentAskLog(ctx context.Context, id int64, input, output, total int64, durationMs int, status, errType, errMsg string) error {
	if id <= 0 {
		return nil
	}
	status = strings.TrimSpace(status)
	if status == "" {
		status = AgentAskStatusCompleted
	}
	if len(errType) > 64 {
		errType = errType[:64]
	}
	if len(errMsg) > 4000 {
		errMsg = errMsg[:4000]
	}
	if durationMs < 0 {
		durationMs = 0
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `
		UPDATE agent_ask_logs SET
		  input_tokens=?, output_tokens=?, total_tokens=?,
		  duration_ms=?, status=?, error_type=?, error_message=NULLIF(?,''), finished_at=NOW()
		WHERE id=?`,
		input, output, total, durationMs, status, errType, errMsg, id)
	if err != nil {
		return err
	}
	// ask_log_id 是主键：即使上层因网络/超时重试 Finish，也只能写入一次，
	// 因此累计 Token 不会重复执行。
	insert := `INSERT IGNORE INTO agent_token_usage_records
		(ask_log_id, usage_date, engine, input_tokens, output_tokens, cache_tokens, total_tokens, estimated, recorded_at)
		SELECT id, DATE(started_at), engine, input_tokens, output_tokens, 0, total_tokens, 0, NOW()
		FROM agent_ask_logs WHERE id=?`
	if s.IsSQLite() {
		insert = `INSERT OR IGNORE INTO agent_token_usage_records
			(ask_log_id, usage_date, engine, input_tokens, output_tokens, cache_tokens, total_tokens, estimated, recorded_at)
			SELECT id, date(started_at), engine, input_tokens, output_tokens, 0, total_tokens, 0, CURRENT_TIMESTAMP
			FROM agent_ask_logs WHERE id=?`
	}
	if _, err = tx.ExecContext(ctx, insert, id); err != nil {
		return err
	}
	return tx.Commit()
}

func normalizeTokenUsageEngine(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "codex":
		return "codex"
	case "claude":
		return "claude"
	case "cursor", "agent":
		return "cursor"
	default:
		return "unknown"
	}
}

func (s *Store) backfillProfileTokenUsage(ctx context.Context) error {
	query := `INSERT IGNORE INTO agent_token_usage_records
		(ask_log_id, usage_date, engine, input_tokens, output_tokens, cache_tokens, total_tokens, estimated, recorded_at)
		SELECT l.id, DATE(l.started_at),
		  CASE LOWER(TRIM(COALESCE(NULLIF(NULLIF(l.engine,''),'unknown'), NULLIF(a.engine,''), 'unknown')))
		    WHEN 'agent' THEN 'cursor' WHEN 'codex' THEN 'codex' WHEN 'claude' THEN 'claude' WHEN 'cursor' THEN 'cursor' ELSE 'unknown' END,
		  l.input_tokens, l.output_tokens, 0, l.total_tokens, 1, NOW()
		FROM agent_ask_logs l LEFT JOIN managed_agents a ON a.id=l.agent_id
		WHERE l.status <> ?`
	if s.IsSQLite() {
		query = `INSERT OR IGNORE INTO agent_token_usage_records
			(ask_log_id, usage_date, engine, input_tokens, output_tokens, cache_tokens, total_tokens, estimated, recorded_at)
			SELECT l.id, date(l.started_at),
			  CASE LOWER(TRIM(COALESCE(NULLIF(NULLIF(l.engine,''),'unknown'), NULLIF(a.engine,''), 'unknown')))
			    WHEN 'agent' THEN 'cursor' WHEN 'codex' THEN 'codex' WHEN 'claude' THEN 'claude' WHEN 'cursor' THEN 'cursor' ELSE 'unknown' END,
			  l.input_tokens, l.output_tokens, 0, l.total_tokens, 1, CURRENT_TIMESTAMP
			FROM agent_ask_logs l LEFT JOIN managed_agents a ON a.id=l.agent_id
			WHERE l.status <> ?`
	}
	_, err := s.db.ExecContext(ctx, query, AgentAskStatusProcessing)
	return err
}

// ListProfileTokenUsage 从长期、无正文的用量表读取日汇总。
func (s *Store) ListProfileTokenUsage(ctx context.Context, from, to time.Time, engine string) ([]ProfileTokenUsageDay, error) {
	engine = strings.ToLower(strings.TrimSpace(engine))
	where := "usage_date >= ? AND usage_date < ?"
	args := []any{from.Format("2006-01-02"), to.Format("2006-01-02")}
	if engine != "" && engine != "all" {
		where += " AND engine=?"
		args = append(args, engine)
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT usage_date, COALESCE(SUM(total_tokens),0), COALESCE(MAX(estimated),0)
		FROM agent_token_usage_records WHERE %s
		GROUP BY usage_date ORDER BY usage_date`, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ProfileTokenUsageDay, 0)
	for rows.Next() {
		var date any
		var item ProfileTokenUsageDay
		var estimated int
		if err := rows.Scan(&date, &item.TotalTokens, &estimated); err != nil {
			return nil, err
		}
		item.Date = formatSQLDateBucket(date)
		item.Estimated = estimated != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

// InsertAgentAskToolCall 追加工具调用。
func (s *Store) InsertAgentAskToolCall(ctx context.Context, askLogID, agentID int64, toolName, result string, durationMs int) error {
	if askLogID <= 0 || agentID <= 0 {
		return nil
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return nil
	}
	if len(toolName) > 128 {
		toolName = toolName[:128]
	}
	result = strings.TrimSpace(result)
	if result == "" {
		result = AgentAskToolOK
	}
	if durationMs < 0 {
		durationMs = 0
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_ask_tool_calls (ask_log_id, agent_id, tool_name, result, duration_ms)
		VALUES (?,?,?,?,?)`, askLogID, agentID, toolName, result, durationMs)
	return err
}

// LatestAgentAskRuntimeDetail 返回最近一轮运行；包含 processing，供页面刷新后恢复当前运行态。
func (s *Store) LatestAgentAskRuntimeDetail(ctx context.Context, agentID int64) (*AgentAskRuntimeDetail, error) {
	if agentID <= 0 {
		return nil, nil
	}
	_, _ = s.PurgeAgentLLMInvocations(ctx, time.Now().Add(-agentLLMTraceRetention))
	var out AgentAskRuntimeDetail
	err := s.db.QueryRowContext(ctx, `
		SELECT id, agent_id, conversation_id, user_message_id, source, status,
		       duration_ms, input_tokens, output_tokens, total_tokens,
		       IFNULL(error_type,''), IFNULL(error_message,''),
		       started_at, finished_at, created_at
		FROM agent_ask_logs
		WHERE agent_id=?
		ORDER BY started_at DESC, id DESC
		LIMIT 1`, agentID).Scan(
		&out.ID, &out.AgentID, &out.ConversationID, &out.UserMessageID, &out.Source, &out.Status,
		&out.DurationMs, &out.InputTokens, &out.OutputTokens, &out.TotalTokens,
		&out.ErrorType, &out.ErrorMessage, &out.StartedAt, &out.FinishedAt, &out.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, ask_log_id, agent_id, tool_name, result, duration_ms, created_at
		FROM agent_ask_tool_calls
		WHERE ask_log_id=?
		ORDER BY id`, out.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tool AgentAskToolCall
		if err := rows.Scan(&tool.ID, &tool.AskLogID, &tool.AgentID, &tool.ToolName, &tool.Result, &tool.DurationMs, &tool.CreatedAt); err != nil {
			return nil, err
		}
		out.Tools = append(out.Tools, tool)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out.Tools == nil {
		out.Tools = []AgentAskToolCall{}
	}

	// 命令审计包含真实调用内容；运行明细用它替换只有工具名的同类活动。
	end := time.Now().Add(time.Second)
	if out.FinishedAt != nil {
		end = out.FinishedAt.Add(time.Second)
	}
	cmdRows, err := s.db.QueryContext(ctx, `
		SELECT id, tool_name, command_text, decision, created_at
		FROM command_audits
		WHERE agent_id=? AND created_at>=? AND created_at<=?
		ORDER BY id`, out.AgentID, out.StartedAt.Add(-time.Second), end)
	if err != nil {
		return nil, err
	}
	defer cmdRows.Close()
	commandTools := map[string]bool{}
	var commands []AgentAskToolCall
	for cmdRows.Next() {
		var tool AgentAskToolCall
		var decision string
		if err := cmdRows.Scan(&tool.ID, &tool.ToolName, &tool.Summary, &decision, &tool.CreatedAt); err != nil {
			return nil, err
		}
		tool.ID = -tool.ID // 与 agent_ask_tool_calls 的 ID 隔离，避免前端 key 冲突。
		tool.AgentID = out.AgentID
		tool.Result = AgentAskToolOK
		if decision != "allow" {
			tool.Result = AgentAskToolDenied
		}
		commandTools[strings.ToLower(strings.TrimSpace(tool.ToolName))] = true
		commands = append(commands, tool)
	}
	if err := cmdRows.Err(); err != nil {
		return nil, err
	}
	filtered := out.Tools[:0]
	for _, tool := range out.Tools {
		name := strings.ToLower(strings.TrimSpace(tool.ToolName))
		if name == "agent" || name == "codex" || name == "cursor" || name == "claude" || commandTools[name] {
			continue
		}
		filtered = append(filtered, tool)
	}
	out.Tools = append(filtered, commands...)
	sort.SliceStable(out.Tools, func(i, j int) bool {
		return out.Tools[i].CreatedAt.Before(out.Tools[j].CreatedAt)
	})

	traceRows, err := s.db.QueryContext(ctx, `
		SELECT id, ask_log_id, agent_id, step_no, engine, source, model, status,
		       duration_ms, input_tokens, output_tokens, cache_tokens,
		       context_window, context_used, IFNULL(input_content,''), IFNULL(output_content,''),
		       input_truncated, output_truncated, availability_note,
		       started_at, finished_at, created_at
		FROM agent_llm_invocations
		WHERE ask_log_id=? AND created_at>=?
		ORDER BY step_no, id`, out.ID, time.Now().Add(-agentLLMTraceRetention))
	if err != nil {
		return nil, err
	}
	defer traceRows.Close()
	for traceRows.Next() {
		var item AgentLLMInvocation
		if err := traceRows.Scan(
			&item.ID, &item.AskLogID, &item.AgentID, &item.StepNo, &item.Engine,
			&item.Source, &item.Model, &item.Status, &item.DurationMs,
			&item.InputTokens, &item.OutputTokens, &item.CacheTokens,
			&item.ContextWindow, &item.ContextUsed, &item.InputContent, &item.OutputContent,
			&item.InputTruncated, &item.OutputTruncated, &item.AvailabilityNote,
			&item.StartedAt, &item.FinishedAt, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		out.LLMInvocations = append(out.LLMInvocations, item)
	}
	if err := traceRows.Err(); err != nil {
		return nil, err
	}
	if out.LLMInvocations == nil {
		out.LLMInvocations = []AgentLLMInvocation{}
	}
	return &out, nil
}

func (f AgentAskAuditFilter) normalize() AgentAskAuditFilter {
	out := f
	if out.To.IsZero() {
		out.To = time.Now()
	}
	if out.From.IsZero() {
		out.From = out.To.Add(-7 * 24 * time.Hour)
	}
	return out
}

// agentAskRangeArgs 生成时间与终态过滤；alias 非空时给列加表前缀，避免 JOIN managed_agents 时 status 歧义。
func agentAskRangeArgs(f AgentAskAuditFilter, alias ...string) (where string, args []any) {
	f = f.normalize()
	p := ""
	if len(alias) > 0 && strings.TrimSpace(alias[0]) != "" {
		p = strings.TrimSpace(alias[0]) + "."
	}
	where = fmt.Sprintf(`%sstarted_at >= ? AND %sstarted_at < ? AND %sstatus <> ?`, p, p, p)
	args = []any{f.From, f.To, AgentAskStatusProcessing}
	if f.AgentID > 0 {
		where += fmt.Sprintf(` AND %sagent_id=?`, p)
		args = append(args, f.AgentID)
	}
	return where, args
}

// AgentAskOverviewStats 概览聚合。
func (s *Store) AgentAskOverviewStats(ctx context.Context, f AgentAskAuditFilter) (*AgentAskOverview, error) {
	where, args := agentAskRangeArgs(f)
	out := &AgentAskOverview{}

	row := s.db.QueryRowContext(ctx, fmt.Sprintf(`
		SELECT
		  COUNT(*),
		  COALESCE(SUM(CASE WHEN status=? THEN 1 ELSE 0 END),0),
		  COALESCE(SUM(CASE WHEN status IN (?,?) THEN 1 ELSE 0 END),0),
		  COALESCE(SUM(total_tokens),0),
		  COALESCE(AVG(duration_ms),0)
		FROM agent_ask_logs WHERE %s`, where),
		append([]any{AgentAskStatusCompleted, AgentAskStatusFailed, AgentAskStatusTimeout}, args...)...)
	if err := row.Scan(&out.TotalRuns, &out.CompletedRuns, &out.FailedRuns, &out.TotalTokens, &out.AvgDurationMs); err != nil {
		return nil, err
	}

	statusRows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT status, COUNT(*) FROM agent_ask_logs WHERE %s GROUP BY status`, where), args...)
	if err != nil {
		return nil, err
	}
	defer statusRows.Close()
	for statusRows.Next() {
		var sc AgentAskStatusCount
		if err := statusRows.Scan(&sc.Status, &sc.Count); err != nil {
			return nil, err
		}
		out.StatusCounts = append(out.StatusCounts, sc)
	}
	if err := statusRows.Err(); err != nil {
		return nil, err
	}
	if out.StatusCounts == nil {
		out.StatusCounts = []AgentAskStatusCount{}
	}

	tools, err := s.AgentAskToolAggregates(ctx, f, 3)
	if err != nil {
		return nil, err
	}
	out.TopTools = tools
	return out, nil
}

// formatSQLDateBucket 把 DATE()/周一表达式结果收成 YYYY-MM-DD（兼容 MySQL time 与 SQLite TEXT）。
func formatSQLDateBucket(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case time.Time:
		if t.IsZero() {
			return ""
		}
		return t.Format("2006-01-02")
	case []byte:
		s := strings.TrimSpace(string(t))
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	case string:
		s := strings.TrimSpace(t)
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	default:
		s := strings.TrimSpace(fmt.Sprint(t))
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	}
}

func scanAskTokenBuckets(rows *sql.Rows) ([]AgentAskTokenBucket, error) {
	var out []AgentAskTokenBucket
	for rows.Next() {
		var b AgentAskTokenBucket
		var day any
		if err := rows.Scan(&day, &b.InputTokens, &b.OutputTokens, &b.TotalTokens); err != nil {
			return nil, err
		}
		b.Bucket = formatSQLDateBucket(day)
		out = append(out, b)
	}
	if out == nil {
		out = []AgentAskTokenBucket{}
	}
	return out, rows.Err()
}

// AgentAskTokensDaily 按自然日聚合 Token。
func (s *Store) AgentAskTokensDaily(ctx context.Context, f AgentAskAuditFilter) ([]AgentAskTokenBucket, error) {
	where, args := agentAskRangeArgs(f)
	dayExpr := "DATE(started_at)"
	if s.IsSQLite() {
		dayExpr = "date(started_at)"
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT %s AS d,
		       COALESCE(SUM(input_tokens),0),
		       COALESCE(SUM(output_tokens),0),
		       COALESCE(SUM(total_tokens),0)
		FROM agent_ask_logs WHERE %s
		GROUP BY %s ORDER BY d`, dayExpr, where, dayExpr), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAskTokenBuckets(rows)
}

// AgentAskTokensWeekly 按自然周（周一）聚合 Token。
func (s *Store) AgentAskTokensWeekly(ctx context.Context, f AgentAskAuditFilter) ([]AgentAskTokenBucket, error) {
	where, args := agentAskRangeArgs(f)
	// MySQL WEEKDAY: 周一=0；SQLite strftime %%w: 周日=0 → 换算到周一
	weekExpr := "DATE_SUB(DATE(started_at), INTERVAL WEEKDAY(started_at) DAY)"
	if s.IsSQLite() {
		weekExpr = `date(started_at, '-' || ((CAST(strftime('%w', started_at) AS INTEGER) + 6) % 7) || ' days')`
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT %s AS week_start,
		       COALESCE(SUM(input_tokens),0),
		       COALESCE(SUM(output_tokens),0),
		       COALESCE(SUM(total_tokens),0)
		FROM agent_ask_logs WHERE %s
		GROUP BY week_start ORDER BY week_start`, weekExpr, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAskTokenBuckets(rows)
}

// AgentAskToolAggregates 按工具聚合；limit<=0 表示全部。
func (s *Store) AgentAskToolAggregates(ctx context.Context, f AgentAskAuditFilter, limit int) ([]AgentAskToolAggregate, error) {
	f = f.normalize()
	where := `c.created_at >= ? AND c.created_at < ?`
	args := []any{f.From, f.To}
	if f.AgentID > 0 {
		where += ` AND c.agent_id=?`
		args = append(args, f.AgentID)
	}
	q := fmt.Sprintf(`
		SELECT c.tool_name,
		       COUNT(*),
		       COALESCE(SUM(CASE WHEN c.result=? THEN 1 ELSE 0 END),0),
		       COALESCE(SUM(CASE WHEN c.result=? THEN 1 ELSE 0 END),0),
		       COALESCE(SUM(CASE WHEN c.result=? THEN 1 ELSE 0 END),0),
		       COALESCE(AVG(c.duration_ms),0)
		FROM agent_ask_tool_calls c
		WHERE %s
		GROUP BY c.tool_name
		ORDER BY COUNT(*) DESC`, where)
	args = append([]any{AgentAskToolOK, AgentAskToolError, AgentAskToolDenied}, args...)
	if limit > 0 {
		q += ` LIMIT ?`
		args = append(args, limit)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentAskToolAggregate
	for rows.Next() {
		var t AgentAskToolAggregate
		if err := rows.Scan(&t.ToolName, &t.CallCount, &t.OkCount, &t.ErrorCount, &t.DeniedCount, &t.AvgDurationMs); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []AgentAskToolAggregate{}
	}
	return out, rows.Err()
}

// ListAgentAskErrors 最近错误（非完成态且有错误信息，或 failed/timeout）。
func (s *Store) ListAgentAskErrors(ctx context.Context, f AgentAskAuditFilter, limit int) ([]AgentAskErrorRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	where, args := agentAskRangeArgs(f, "l")
	where += ` AND l.status IN (?,?,?)`
	args = append(args, AgentAskStatusFailed, AgentAskStatusTimeout, AgentAskStatusInterrupted)
	q := fmt.Sprintf(`
		SELECT l.id, l.agent_id, IFNULL(a.name,''), l.status, IFNULL(l.error_type,''), IFNULL(l.error_message,''), l.started_at
		FROM agent_ask_logs l
		LEFT JOIN managed_agents a ON a.id = l.agent_id
		WHERE %s
		ORDER BY l.started_at DESC LIMIT ?`, where)
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentAskErrorRow
	for rows.Next() {
		var r AgentAskErrorRow
		if err := rows.Scan(&r.ID, &r.AgentID, &r.AgentName, &r.Status, &r.ErrorType, &r.ErrorMessage, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if out == nil {
		out = []AgentAskErrorRow{}
	}
	return out, rows.Err()
}
