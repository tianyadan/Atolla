package store

import (
	"context"
	"database/sql"
	"fmt"
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

// AgentAskLog 数字员工一轮 Ask。
type AgentAskLog struct {
	ID             int64      `json:"id"`
	AgentID        int64      `json:"agent_id"`
	ConversationID int64      `json:"conversation_id"`
	UserMessageID  int64      `json:"user_message_id"`
	Source         string     `json:"source"`
	Status         string     `json:"status"`
	DurationMs     int        `json:"duration_ms"`
	InputTokens    int64      `json:"input_tokens"`
	OutputTokens   int64      `json:"output_tokens"`
	TotalTokens    int64      `json:"total_tokens"`
	ErrorType      string     `json:"error_type,omitempty"`
	ErrorMessage   string     `json:"error_message,omitempty"`
	StartedAt      time.Time  `json:"started_at"`
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// AgentAskToolCall 一轮内的工具调用。
type AgentAskToolCall struct {
	ID         int64     `json:"id"`
	AskLogID   int64     `json:"ask_log_id"`
	AgentID    int64     `json:"agent_id"`
	ToolName   string    `json:"tool_name"`
	Result     string    `json:"result"`
	DurationMs int       `json:"duration_ms"`
	CreatedAt  time.Time `json:"created_at"`
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
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS agent_ask_logs (
		  id                BIGINT        NOT NULL AUTO_INCREMENT,
		  agent_id          BIGINT        NOT NULL,
		  conversation_id   BIGINT        NOT NULL DEFAULT 0,
		  user_message_id   BIGINT        NOT NULL DEFAULT 0,
		  source            VARCHAR(16)   NOT NULL DEFAULT 'admin',
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
	if _, err := s.db.ExecContext(ctx, `
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
	return nil
}

// BeginAgentAskLog 用户消息落库后创建 processing 行。
func (s *Store) BeginAgentAskLog(ctx context.Context, agentID, convID, userMsgID int64, source string) (int64, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		source = AgentAskSourceAdmin
	}
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_ask_logs
		  (agent_id, conversation_id, user_message_id, source, status, started_at)
		VALUES (?,?,?,?,?,NOW())`,
		agentID, convID, userMsgID, source, AgentAskStatusProcessing)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
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
	_, err := s.db.ExecContext(ctx, `
		UPDATE agent_ask_logs SET
		  input_tokens=?, output_tokens=?, total_tokens=?,
		  duration_ms=?, status=?, error_type=?, error_message=NULLIF(?,''), finished_at=NOW()
		WHERE id=?`,
		input, output, total, durationMs, status, errType, errMsg, id)
	return err
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

// AgentAskTokensDaily 按自然日聚合 Token。
func (s *Store) AgentAskTokensDaily(ctx context.Context, f AgentAskAuditFilter) ([]AgentAskTokenBucket, error) {
	where, args := agentAskRangeArgs(f)
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT DATE(started_at) AS d,
		       COALESCE(SUM(input_tokens),0),
		       COALESCE(SUM(output_tokens),0),
		       COALESCE(SUM(total_tokens),0)
		FROM agent_ask_logs WHERE %s
		GROUP BY DATE(started_at) ORDER BY d`, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentAskTokenBucket
	for rows.Next() {
		var b AgentAskTokenBucket
		var d sql.NullTime
		if err := rows.Scan(&d, &b.InputTokens, &b.OutputTokens, &b.TotalTokens); err != nil {
			return nil, err
		}
		if d.Valid {
			b.Bucket = d.Time.Format("2006-01-02")
		}
		out = append(out, b)
	}
	if out == nil {
		out = []AgentAskTokenBucket{}
	}
	return out, rows.Err()
}

// AgentAskTokensWeekly 按自然周（周一）聚合 Token。
func (s *Store) AgentAskTokensWeekly(ctx context.Context, f AgentAskAuditFilter) ([]AgentAskTokenBucket, error) {
	where, args := agentAskRangeArgs(f)
	// MySQL: DATE_SUB(DATE(started_at), INTERVAL WEEKDAY(started_at) DAY) = 该周周一
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT DATE_SUB(DATE(started_at), INTERVAL WEEKDAY(started_at) DAY) AS week_start,
		       COALESCE(SUM(input_tokens),0),
		       COALESCE(SUM(output_tokens),0),
		       COALESCE(SUM(total_tokens),0)
		FROM agent_ask_logs WHERE %s
		GROUP BY week_start ORDER BY week_start`, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentAskTokenBucket
	for rows.Next() {
		var b AgentAskTokenBucket
		var d sql.NullTime
		if err := rows.Scan(&d, &b.InputTokens, &b.OutputTokens, &b.TotalTokens); err != nil {
			return nil, err
		}
		if d.Valid {
			b.Bucket = d.Time.Format("2006-01-02")
		}
		out = append(out, b)
	}
	if out == nil {
		out = []AgentAskTokenBucket{}
	}
	return out, rows.Err()
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
