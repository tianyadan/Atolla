package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// 任务队列状态（系统状态机，非模型控制）。
const (
	TaskQueued    = "queued"
	TaskRunning   = "running"
	TaskPaused    = "paused"
	TaskDone      = "done"
	TaskFailed    = "failed"
	TaskCancelled = "cancelled"
)

const (
	TaskQueueMaxActive = 20
	TaskQueueMaxPaused = 5
	TaskQueueDoneKeep  = 20
)

// AgentTaskQueueItem 数字人持久化任务队列项。
type AgentTaskQueueItem struct {
	ID             int64      `json:"id"`
	AgentID        int64      `json:"agent_id"`
	ConversationID int64      `json:"conversation_id"`
	Status         string     `json:"status"`
	Question       string     `json:"question"`
	AttachmentsJSON string    `json:"attachments_json,omitempty"`
	Position       int        `json:"position"`
	PauseRank      *int       `json:"pause_rank,omitempty"`
	ErrorText      string     `json:"error_text,omitempty"`
	SilentNotify   bool       `json:"silent_notify"`
	CreatedAt      time.Time  `json:"created_at"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
	// ResumeHint 非持久化：刚从 paused claim 出来，Ask 需加系统前缀。
	ResumeHint bool `json:"resume_hint,omitempty"`
}

// EnsureAgentTaskQueueSchema 创建任务队列表与 hold 标记表。
func (s *Store) EnsureAgentTaskQueueSchema(ctx context.Context) error {
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS agent_task_queue (
		  id               BIGINT NOT NULL AUTO_INCREMENT,
		  agent_id         BIGINT NOT NULL,
		  conversation_id  BIGINT NOT NULL DEFAULT 0,
		  status           VARCHAR(32) NOT NULL,
		  question         TEXT NOT NULL,
		  attachments_json TEXT NULL,
		  position         INT NOT NULL DEFAULT 0,
		  pause_rank       INT NULL,
		  error_text       VARCHAR(512) NULL,
		  silent_notify    TINYINT NOT NULL DEFAULT 0,
		  created_at       DATETIME NOT NULL,
		  started_at       DATETIME NULL,
		  finished_at      DATETIME NULL,
		  PRIMARY KEY (id),
		  KEY idx_atq_agent_status (agent_id, status),
		  KEY idx_atq_agent_pos (agent_id, position),
		  KEY idx_atq_agent_pause (agent_id, pause_rank)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	return s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS agent_task_queue_hold (
		  agent_id   BIGINT NOT NULL,
		  held       TINYINT NOT NULL DEFAULT 0,
		  updated_at DATETIME NOT NULL,
		  PRIMARY KEY (agent_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

func scanTaskQueueItem(scanner interface{ Scan(dest ...any) error }) (AgentTaskQueueItem, error) {
	var it AgentTaskQueueItem
	var att, errText sql.NullString
	var pause sql.NullInt64
	var silent int
	var started, finished sql.NullTime
	err := scanner.Scan(
		&it.ID, &it.AgentID, &it.ConversationID, &it.Status, &it.Question, &att,
		&it.Position, &pause, &errText, &silent, &it.CreatedAt, &started, &finished,
	)
	if err != nil {
		return it, err
	}
	if att.Valid {
		it.AttachmentsJSON = att.String
	}
	if errText.Valid {
		it.ErrorText = errText.String
	}
	if pause.Valid {
		v := int(pause.Int64)
		it.PauseRank = &v
	}
	it.SilentNotify = silent != 0
	if started.Valid {
		t := started.Time
		it.StartedAt = &t
	}
	if finished.Valid {
		t := finished.Time
		it.FinishedAt = &t
	}
	return it, nil
}

const taskQueueSelectCols = `id, agent_id, conversation_id, status, question, attachments_json,
		position, pause_rank, error_text, silent_notify, created_at, started_at, finished_at`

// ListAgentTaskQueue 活跃项 + 最近完成（供绿灯轨）。
func (s *Store) ListAgentTaskQueue(ctx context.Context, agentID int64, doneLimit int) ([]AgentTaskQueueItem, error) {
	if doneLimit <= 0 {
		doneLimit = TaskQueueDoneKeep
	}
	// 活跃项按队列 position 倒序：越新（更大 position）越靠前；不按 status 把 running 置顶。
	// 已完成另查并接在后面（finished_at 新→旧）。
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+taskQueueSelectCols+` FROM agent_task_queue
		WHERE agent_id = ? AND status IN (?, ?, ?)
		ORDER BY position DESC, id DESC`,
		agentID, TaskQueued, TaskRunning, TaskPaused)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentTaskQueueItem
	for rows.Next() {
		it, err := scanTaskQueueItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	doneRows, err := s.db.QueryContext(ctx, `
		SELECT `+taskQueueSelectCols+` FROM agent_task_queue
		WHERE agent_id = ? AND status IN (?, ?, ?)
		ORDER BY finished_at DESC, id DESC
		LIMIT ?`,
		agentID, TaskDone, TaskFailed, TaskCancelled, doneLimit)
	if err != nil {
		return out, err
	}
	defer doneRows.Close()
	for doneRows.Next() {
		it, err := scanTaskQueueItem(doneRows)
		if err != nil {
			return out, err
		}
		out = append(out, it)
	}
	return out, doneRows.Err()
}

// CountAgentTaskActive 统计 queued+paused+running。
func (s *Store) CountAgentTaskActive(ctx context.Context, agentID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM agent_task_queue
		WHERE agent_id = ? AND status IN (?, ?, ?)`,
		agentID, TaskQueued, TaskRunning, TaskPaused).Scan(&n)
	return n, err
}

// CountAgentTaskPaused paused 数量。
func (s *Store) CountAgentTaskPaused(ctx context.Context, agentID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM agent_task_queue WHERE agent_id = ? AND status = ?`,
		agentID, TaskPaused).Scan(&n)
	return n, err
}

// GetAgentTaskQueueItem 按 id 读取。
func (s *Store) GetAgentTaskQueueItem(ctx context.Context, id int64) (*AgentTaskQueueItem, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+taskQueueSelectCols+` FROM agent_task_queue WHERE id = ?`, id)
	it, err := scanTaskQueueItem(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// GetRunningAgentTask 当前 running 项。
func (s *Store) GetRunningAgentTask(ctx context.Context, agentID int64) (*AgentTaskQueueItem, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT `+taskQueueSelectCols+` FROM agent_task_queue
		WHERE agent_id = ? AND status = ? ORDER BY id DESC LIMIT 1`,
		agentID, TaskRunning)
	it, err := scanTaskQueueItem(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// InsertAgentTaskQueue 插入队列项，返回 id。
func (s *Store) InsertAgentTaskQueue(ctx context.Context, it AgentTaskQueueItem) (int64, error) {
	now := time.Now().UTC()
	if it.CreatedAt.IsZero() {
		it.CreatedAt = now
	}
	silent := 0
	if it.SilentNotify {
		silent = 1
	}
	var pause any
	if it.PauseRank != nil {
		pause = *it.PauseRank
	}
	var started, finished any
	if it.StartedAt != nil {
		started = *it.StartedAt
	}
	if it.FinishedAt != nil {
		finished = *it.FinishedAt
	}
	att := any(nil)
	if strings.TrimSpace(it.AttachmentsJSON) != "" {
		att = it.AttachmentsJSON
	}
	errText := any(nil)
	if strings.TrimSpace(it.ErrorText) != "" {
		errText = it.ErrorText
	}
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_task_queue
		(agent_id, conversation_id, status, question, attachments_json, position, pause_rank, error_text, silent_notify, created_at, started_at, finished_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		it.AgentID, it.ConversationID, it.Status, it.Question, att, it.Position, pause, errText, silent,
		it.CreatedAt, started, finished)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// NextAgentTaskPosition 下一个入队 position（相对全部活跃项取 max，保证越新越大）。
func (s *Store) NextAgentTaskPosition(ctx context.Context, agentID int64) (int, error) {
	var max sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT MAX(position) FROM agent_task_queue
		WHERE agent_id = ? AND status IN (?, ?, ?)`,
		agentID, TaskQueued, TaskRunning, TaskPaused).Scan(&max)
	if err != nil {
		return 1, err
	}
	if !max.Valid {
		return 1, nil
	}
	return int(max.Int64) + 1, nil
}

// NextAgentTaskPauseRank 下一个 pause_rank（越大越先恢复）。
func (s *Store) NextAgentTaskPauseRank(ctx context.Context, agentID int64) (int, error) {
	var max sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT MAX(pause_rank) FROM agent_task_queue WHERE agent_id = ? AND status = ?`,
		agentID, TaskPaused).Scan(&max)
	if err != nil {
		return 1, err
	}
	if !max.Valid {
		return 1, nil
	}
	return int(max.Int64) + 1, nil
}

// PauseAgentTaskRunning 将 running 标为 paused（幂等条件更新）。
func (s *Store) PauseAgentTaskRunning(ctx context.Context, id int64, pauseRank int) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET status = ?, pause_rank = ?, started_at = started_at
		WHERE id = ? AND status = ?`,
		TaskPaused, pauseRank, id, TaskRunning)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// CompleteAgentTaskRunning 将 running 标为终态（幂等）。
func (s *Store) CompleteAgentTaskRunning(ctx context.Context, id int64, status, errText string) (bool, error) {
	if status != TaskDone && status != TaskFailed && status != TaskCancelled {
		return false, fmt.Errorf("invalid complete status %q", status)
	}
	now := time.Now().UTC()
	var et any
	if strings.TrimSpace(errText) != "" {
		et = truncateRunes(errText, 500)
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET status = ?, error_text = ?, finished_at = ?, pause_rank = NULL
		WHERE id = ? AND status = ?`,
		status, et, now, id, TaskRunning)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ClaimPausedAgentTask 取 pause_rank 最大的 paused → running。
func (s *Store) ClaimPausedAgentTask(ctx context.Context, agentID int64) (*AgentTaskQueueItem, error) {
	it, err := s.peekPausedAgentTask(ctx, agentID)
	if err != nil || it == nil {
		return it, err
	}
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET status = ?, started_at = ?, pause_rank = NULL, silent_notify = 1
		WHERE id = ? AND status = ?`,
		TaskRunning, now, it.ID, TaskPaused)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, nil
	}
	it.Status = TaskRunning
	it.StartedAt = &now
	it.PauseRank = nil
	it.SilentNotify = true
	it.ResumeHint = true
	return it, nil
}

func (s *Store) peekPausedAgentTask(ctx context.Context, agentID int64) (*AgentTaskQueueItem, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT `+taskQueueSelectCols+` FROM agent_task_queue
		WHERE agent_id = ? AND status = ?
		ORDER BY pause_rank DESC, id DESC LIMIT 1`,
		agentID, TaskPaused)
	it, err := scanTaskQueueItem(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// ClaimQueuedAgentTask 取 position 最小的 queued → running。
func (s *Store) ClaimQueuedAgentTask(ctx context.Context, agentID int64) (*AgentTaskQueueItem, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT `+taskQueueSelectCols+` FROM agent_task_queue
		WHERE agent_id = ? AND status = ?
		ORDER BY position ASC, id ASC LIMIT 1`,
		agentID, TaskQueued)
	it, err := scanTaskQueueItem(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET status = ?, started_at = ?, silent_notify = 1
		WHERE id = ? AND status = ?`,
		TaskRunning, now, it.ID, TaskQueued)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, nil
	}
	it.Status = TaskRunning
	it.StartedAt = &now
	it.SilentNotify = true
	return &it, nil
}

// CancelAgentTask 取消 queued 或 paused。
func (s *Store) CancelAgentTask(ctx context.Context, agentID, taskID int64) (bool, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET status = ?, finished_at = ?, pause_rank = NULL
		WHERE id = ? AND agent_id = ? AND status IN (?, ?)`,
		TaskCancelled, now, taskID, agentID, TaskQueued, TaskPaused)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// UpdateAgentTaskQuestion 仅允许改尚未执行的 queued / paused 文案。
func (s *Store) UpdateAgentTaskQuestion(ctx context.Context, agentID, taskID int64, question string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET question = ?
		WHERE id = ? AND agent_id = ? AND status IN (?, ?)`,
		question, taskID, agentID, TaskQueued, TaskPaused)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ClearAgentTaskDone 清除已完成展示项。
func (s *Store) ClearAgentTaskDone(ctx context.Context, agentID int64) (int64, error) {
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM agent_task_queue WHERE agent_id = ? AND status IN (?, ?, ?)`,
		agentID, TaskDone, TaskFailed, TaskCancelled)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DemoteRunningAgentTasksToPaused 启动时假 running → paused，返回受影响 agent_id。
func (s *Store) DemoteRunningAgentTasksToPaused(ctx context.Context) (n int64, agentIDs []int64, err error) {
	rows, qerr := s.db.QueryContext(ctx, `
		SELECT DISTINCT agent_id FROM agent_task_queue WHERE status = ?`, TaskRunning)
	if qerr != nil {
		return 0, nil, qerr
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if scanErr := rows.Scan(&id); scanErr != nil {
			return 0, nil, scanErr
		}
		agentIDs = append(agentIDs, id)
	}
	if err = rows.Err(); err != nil {
		return 0, nil, err
	}
	if len(agentIDs) == 0 {
		return 0, nil, nil
	}
	rank := 1
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_task_queue SET status = ?, pause_rank = COALESCE(pause_rank, ?)
		WHERE status = ?`,
		TaskPaused, rank, TaskRunning)
	if err != nil {
		return 0, nil, err
	}
	n, _ = res.RowsAffected()
	return n, agentIDs, nil
}

// SetAgentTaskQueueHold Stop 后暂停自动续跑。
func (s *Store) SetAgentTaskQueueHold(ctx context.Context, agentID int64, held bool) error {
	v := 0
	if held {
		v = 1
	}
	now := time.Now().UTC()
	q := s.insertOnConflictUpdate(
		`agent_task_queue_hold (agent_id, held, updated_at)`,
		`(?, ?, ?)`,
		`agent_id`,
		`held = VALUES(held), updated_at = VALUES(updated_at)`,
		`held = excluded.held, updated_at = excluded.updated_at`,
	)
	_, err := s.db.ExecContext(ctx, q, agentID, v, now)
	return err
}

// GetAgentTaskQueueHold 是否人工挂起自动续跑。
func (s *Store) GetAgentTaskQueueHold(ctx context.Context, agentID int64) (bool, error) {
	var held int
	err := s.db.QueryRowContext(ctx, `SELECT held FROM agent_task_queue_hold WHERE agent_id = ?`, agentID).Scan(&held)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return held != 0, err
}

// HasActiveAgentTasks 是否存在 queued/paused/running。
func (s *Store) HasActiveAgentTasks(ctx context.Context, agentID int64) (bool, error) {
	n, err := s.CountAgentTaskActive(ctx, agentID)
	return n > 0, err
}

func truncateRunes(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max])
}
