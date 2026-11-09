package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// 调度状态由平台状态机维护，模型只能提供分类建议，不能直接修改状态。
const (
	TaskDispatchPendingClassification = "pending_classification"
	TaskDispatchPendingAssignment     = "pending_assignment"
	TaskDispatchPendingConfirmation   = "pending_confirmation"
	TaskDispatchDispatching           = "dispatching"
	TaskDispatchQueued                = "queued"
	TaskDispatchRunning               = "running"
	TaskDispatchCompleted             = "completed"
	TaskDispatchFailed                = "failed"
	TaskDispatchCancelled             = "cancelled"
	TaskDispatchSuperseded            = "superseded"
)

var taskDispatchPreExecutionStates = []string{
	TaskDispatchPendingClassification,
	TaskDispatchPendingAssignment,
	TaskDispatchPendingConfirmation,
}

// TaskDispatch 保存一次来源修订对应的调度建议与完整审计快照。
// 同一 Issue 的编辑/重开会生成新修订；旧的未确认修订被 superseded，已执行修订保持不变。
type TaskDispatch struct {
	ID                       int64      `json:"id"`
	SourceType               string     `json:"source_type"`
	SourceKey                string     `json:"source_key"`
	SourceKeyHash            string     `json:"-"`
	SourceRevision           string     `json:"source_revision"`
	EventAction              string     `json:"event_action"`
	DeliveryID               string     `json:"delivery_id"`
	IdempotencyKey           string     `json:"idempotency_key"`
	ParentDispatchID         int64      `json:"parent_dispatch_id,omitempty"`
	SupersededByID           int64      `json:"superseded_by_id,omitempty"`
	SourceURL                string     `json:"source_url"`
	TaskTitle                string     `json:"task_title"`
	TaskBody                 string     `json:"task_body"`
	TaskType                 string     `json:"task_type"`
	RequiredRole             string     `json:"required_role"`
	RequiredCapabilitiesJSON string     `json:"required_capabilities_json"`
	OptionalTagsJSON         string     `json:"optional_tags_json"`
	RequiredPermissionsJSON  string     `json:"required_permissions_json"`
	Priority                 string     `json:"priority"`
	DeadlineAt               *time.Time `json:"deadline_at,omitempty"`
	Status                   string     `json:"status"`
	StateVersion             int        `json:"state_version"`
	RecommendedAgentID       int64      `json:"recommended_agent_id,omitempty"`
	AssignedAgentID          int64      `json:"assigned_agent_id,omitempty"`
	QueueTaskID              int64      `json:"queue_task_id,omitempty"`
	CandidatesJSON           string     `json:"candidates_json"`
	DecisionJSON             string     `json:"decision_json"`
	Confidence               float64    `json:"confidence"`
	LLMUsed                  bool       `json:"llm_used"`
	RequiresReview           bool       `json:"requires_review"`
	ConfirmedBy              string     `json:"confirmed_by"`
	StatusReason             string     `json:"status_reason"`
	LastError                string     `json:"last_error"`
	ClassifiedAt             *time.Time `json:"classified_at,omitempty"`
	RecommendedAt            *time.Time `json:"recommended_at,omitempty"`
	ConfirmedAt              *time.Time `json:"confirmed_at,omitempty"`
	QueuedAt                 *time.Time `json:"queued_at,omitempty"`
	StartedAt                *time.Time `json:"started_at,omitempty"`
	FinishedAt               *time.Time `json:"finished_at,omitempty"`
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
}

// TaskDispatchInput 是首次创建、编辑或重开事件的持久化输入。
type TaskDispatchInput struct {
	SourceType     string
	SourceKey      string
	SourceRevision string
	EventAction    string // opened | edited | reopened
	DeliveryID     string
	SourceURL      string
	TaskTitle      string
	TaskBody       string
	Priority       string
	DeadlineAt     *time.Time
	// nil 默认需要人工确认；仅未来可信策略显式传 false 才可关闭。
	RequiresReview *bool
}

// TaskDispatchRegistration 表明本次是新修订还是重复投递。
type TaskDispatchRegistration struct {
	Dispatch  *TaskDispatch
	Duplicate bool
}

// TaskDispatchRecommendationInput 保存分类、候选与解释快照；真正入队由独立原子事务完成。
type TaskDispatchRecommendationInput struct {
	TaskType                 string
	RequiredRole             string
	RequiredCapabilitiesJSON string
	OptionalTagsJSON         string
	RequiredPermissionsJSON  string
	RecommendedAgentID       int64
	CandidatesJSON           string
	DecisionJSON             string
	Confidence               float64
	LLMUsed                  bool
	StatusReason             string
}

// EnsureTaskDispatchSchema 幂等增加员工岗位，并创建调度建议与审计表。
func (s *Store) EnsureTaskDispatchSchema(ctx context.Context) error {
	if err := s.addColumnIfMissing(ctx, "managed_agents", "job_role",
		`ALTER TABLE managed_agents ADD COLUMN job_role VARCHAR(64) NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS task_dispatches (
		  id                         BIGINT NOT NULL AUTO_INCREMENT,
		  source_type                VARCHAR(32) NOT NULL,
		  source_key                 VARCHAR(512) NOT NULL,
		  source_key_hash            CHAR(64) NOT NULL,
		  source_revision            VARCHAR(128) NOT NULL,
		  event_action               VARCHAR(32) NOT NULL,
		  delivery_id                VARCHAR(128) NOT NULL DEFAULT '',
		  idempotency_key            CHAR(64) NOT NULL,
		  parent_dispatch_id         BIGINT NULL,
		  superseded_by_id           BIGINT NULL,
		  source_url                 VARCHAR(1024) NOT NULL DEFAULT '',
		  task_title                 VARCHAR(512) NOT NULL DEFAULT '',
		  task_body                  LONGTEXT NULL,
		  task_type                  VARCHAR(64) NOT NULL DEFAULT '',
		  required_role              VARCHAR(64) NOT NULL DEFAULT '',
		  required_capabilities_json JSON NOT NULL,
		  optional_tags_json         JSON NOT NULL,
		  required_permissions_json  JSON NOT NULL,
		  priority                   VARCHAR(16) NOT NULL DEFAULT 'normal',
		  deadline_at                DATETIME NULL,
		  status                     VARCHAR(32) NOT NULL,
		  state_version              INT NOT NULL DEFAULT 1,
		  recommended_agent_id       BIGINT NULL,
		  assigned_agent_id          BIGINT NULL,
		  queue_task_id              BIGINT NULL,
		  candidates_json            JSON NOT NULL,
		  decision_json              JSON NOT NULL,
		  confidence                 DOUBLE NOT NULL DEFAULT 0,
		  llm_used                   TINYINT NOT NULL DEFAULT 0,
		  requires_review            TINYINT NOT NULL DEFAULT 1,
		  confirmed_by               VARCHAR(128) NOT NULL DEFAULT '',
		  status_reason              VARCHAR(512) NOT NULL DEFAULT '',
		  last_error                 TEXT NULL,
		  classified_at              DATETIME NULL,
		  recommended_at             DATETIME NULL,
		  confirmed_at               DATETIME NULL,
		  queued_at                  DATETIME NULL,
		  started_at                 DATETIME NULL,
		  finished_at                DATETIME NULL,
		  created_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  UNIQUE KEY uq_task_dispatch_idempotency (idempotency_key),
		  KEY idx_task_dispatch_source (source_type, source_key_hash, created_at),
		  KEY idx_task_dispatch_status (status, created_at),
		  KEY idx_task_dispatch_agent (assigned_agent_id, status),
		  KEY idx_task_dispatch_parent (parent_dispatch_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	if !s.IsSQLite() {
		return nil
	}
	// MySQL 索引写在建表语句内；SQLite 方言转换会移除普通 KEY，需要单独补齐。
	for _, ddl := range []string{
		`CREATE INDEX IF NOT EXISTS idx_task_dispatch_source ON task_dispatches (source_type, source_key_hash, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_task_dispatch_status ON task_dispatches (status, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_task_dispatch_agent ON task_dispatches (assigned_agent_id, status)`,
		`CREATE INDEX IF NOT EXISTS idx_task_dispatch_parent ON task_dispatches (parent_dispatch_id)`,
	} {
		if _, err := s.db.ExecContext(ctx, ddl); err != nil {
			return err
		}
	}
	return nil
}

// BuildTaskDispatchIdempotencyKey 以来源、稳定业务键、修订和动作生成重复投递键。
// delivery_id 不参与：GitHub 重投同一事件时 delivery 可能变化，仍必须命中同一记录。
func BuildTaskDispatchIdempotencyKey(sourceType, sourceKey, revision, action string) string {
	return hashTaskDispatchParts(strings.ToLower(strings.TrimSpace(sourceType)), strings.TrimSpace(sourceKey), strings.TrimSpace(revision), strings.ToLower(strings.TrimSpace(action)))
}

func hashTaskDispatchParts(parts ...string) string {
	h := sha256.New()
	for i, part := range parts {
		if i > 0 {
			_, _ = h.Write([]byte{0})
		}
		_, _ = h.Write([]byte(part))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// RegisterTaskDispatchRevision 原子登记来源修订。
// opened/edited/reopened 均创建新修订；精确重复投递直接返回已有记录；新修订只淘汰尚未确认的旧修订。
func (s *Store) RegisterTaskDispatchRevision(ctx context.Context, in TaskDispatchInput) (TaskDispatchRegistration, error) {
	in.SourceType = strings.ToLower(strings.TrimSpace(in.SourceType))
	in.SourceKey = strings.TrimSpace(in.SourceKey)
	in.SourceRevision = strings.TrimSpace(in.SourceRevision)
	in.EventAction = strings.ToLower(strings.TrimSpace(in.EventAction))
	if in.SourceType == "" || in.SourceKey == "" || in.SourceRevision == "" {
		return TaskDispatchRegistration{}, errors.New("dispatch source type, key and revision required")
	}
	if in.EventAction != "opened" && in.EventAction != "edited" && in.EventAction != "reopened" {
		return TaskDispatchRegistration{}, fmt.Errorf("unsupported dispatch event action: %s", in.EventAction)
	}
	if strings.TrimSpace(in.Priority) == "" {
		in.Priority = "normal"
	}
	requiresReview := true
	if in.RequiresReview != nil {
		requiresReview = *in.RequiresReview
	}
	keyHash := hashTaskDispatchParts(in.SourceType, in.SourceKey)
	idempotencyKey := BuildTaskDispatchIdempotencyKey(in.SourceType, in.SourceKey, in.SourceRevision, in.EventAction)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TaskDispatchRegistration{}, err
	}
	defer tx.Rollback()
	if existing, err := getTaskDispatchByIdempotency(ctx, tx, idempotencyKey); err != nil {
		return TaskDispatchRegistration{}, err
	} else if existing != nil {
		return TaskDispatchRegistration{Dispatch: existing, Duplicate: true}, nil
	}

	var parentID sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT id FROM task_dispatches
		WHERE source_type=? AND source_key_hash=? AND source_key=? ORDER BY id DESC LIMIT 1`,
		in.SourceType, keyHash, in.SourceKey).Scan(&parentID)
	if err != nil && err != sql.ErrNoRows {
		return TaskDispatchRegistration{}, err
	}
	var parent any
	if parentID.Valid {
		parent = parentID.Int64
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO task_dispatches
		(source_type, source_key, source_key_hash, source_revision, event_action, delivery_id,
		 idempotency_key, parent_dispatch_id, source_url, task_title, task_body, priority,
		 deadline_at, status, required_capabilities_json, optional_tags_json,
		 required_permissions_json, candidates_json, decision_json, requires_review)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,`+s.jsonParam()+`,`+s.jsonParam()+`,`+s.jsonParam()+`,`+s.jsonParam()+`,`+s.jsonParam()+`,?)`,
		in.SourceType, in.SourceKey, keyHash, in.SourceRevision, in.EventAction, strings.TrimSpace(in.DeliveryID),
		idempotencyKey, parent, strings.TrimSpace(in.SourceURL), strings.TrimSpace(in.TaskTitle), in.TaskBody,
		strings.ToLower(strings.TrimSpace(in.Priority)), in.DeadlineAt, TaskDispatchPendingClassification,
		`[]`, `[]`, `[]`, `[]`, `{}`, bool01(requiresReview))
	if err != nil {
		_ = tx.Rollback()
		if existing, getErr := s.GetTaskDispatchByIdempotencyKey(ctx, idempotencyKey); getErr == nil && existing != nil {
			return TaskDispatchRegistration{Dispatch: existing, Duplicate: true}, nil
		}
		return TaskDispatchRegistration{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return TaskDispatchRegistration{}, err
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(taskDispatchPreExecutionStates)), ",")
	args := []any{TaskDispatchSuperseded, "来源产生新修订", id, id, in.SourceType, keyHash, in.SourceKey}
	for _, state := range taskDispatchPreExecutionStates {
		args = append(args, state)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE task_dispatches
		SET status=?, status_reason=?, superseded_by_id=?, finished_at=NOW(), updated_at=NOW(), state_version=state_version+1
		WHERE id<>? AND source_type=? AND source_key_hash=? AND source_key=? AND status IN (`+placeholders+`)`, args...); err != nil {
		return TaskDispatchRegistration{}, err
	}
	created, err := getTaskDispatchByID(ctx, tx, id)
	if err != nil {
		return TaskDispatchRegistration{}, err
	}
	if err := tx.Commit(); err != nil {
		return TaskDispatchRegistration{}, err
	}
	return TaskDispatchRegistration{Dispatch: created}, nil
}

// GetTaskDispatchByIdempotencyKey 查询一个来源修订，用于 Webhook 重试快速返回。
func (s *Store) GetTaskDispatchByIdempotencyKey(ctx context.Context, key string) (*TaskDispatch, error) {
	return getTaskDispatchByIdempotency(ctx, s.db, strings.TrimSpace(key))
}

// GetTaskDispatch 返回单条调度审计记录。
func (s *Store) GetTaskDispatch(ctx context.Context, id int64) (*TaskDispatch, error) {
	return getTaskDispatchByID(ctx, s.db, id)
}

// ListTaskDispatches 按时间倒序返回调度历史，供管理界面审计。
func (s *Store) ListTaskDispatches(ctx context.Context, sourceType string, limit int) ([]TaskDispatch, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := `SELECT ` + taskDispatchSelectCols + ` FROM task_dispatches`
	args := []any{}
	if sourceType = strings.TrimSpace(sourceType); sourceType != "" {
		query += ` WHERE source_type=?`
		args = append(args, sourceType)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TaskDispatch, 0, limit)
	for rows.Next() {
		item, err := scanTaskDispatchRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, rows.Err()
}

// CreateTaskDispatchManualRetry 为失败/待分派记录创建新的子记录，保留原审计行不被覆盖。
func (s *Store) CreateTaskDispatchManualRetry(ctx context.Context, originalID, agentID int64, decisionJSON string) (*TaskDispatch, error) {
	if originalID <= 0 || agentID <= 0 {
		return nil, errors.New("original dispatch and agent required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	original, err := getTaskDispatchByID(ctx, tx, originalID)
	if err != nil {
		return nil, err
	}
	if original == nil {
		return nil, errors.New("dispatch not found")
	}
	retryable := original.Status == TaskDispatchPendingAssignment || original.Status == TaskDispatchFailed || original.Status == TaskDispatchCancelled
	if !retryable && original.QueueTaskID > 0 {
		var queueStatus string
		if err := tx.QueryRowContext(ctx, `SELECT status FROM agent_task_queue WHERE id=?`, original.QueueTaskID).Scan(&queueStatus); err == nil {
			retryable = queueStatus == TaskFailed || queueStatus == TaskCancelled
		}
	}
	if !retryable {
		return nil, fmt.Errorf("dispatch is not retryable: %s", original.Status)
	}
	if strings.TrimSpace(decisionJSON) == "" {
		decisionJSON = `{}`
	}
	now := time.Now().UTC()
	revision := fmt.Sprintf("%s:manual:%d", original.SourceRevision, now.UnixNano())
	idempotencyKey := BuildTaskDispatchIdempotencyKey(original.SourceType, original.SourceKey, revision, "manual_reassign")
	res, err := tx.ExecContext(ctx, `INSERT INTO task_dispatches
		(source_type, source_key, source_key_hash, source_revision, event_action, delivery_id,
		 idempotency_key, parent_dispatch_id, source_url, task_title, task_body, task_type, required_role,
		 required_capabilities_json, optional_tags_json, required_permissions_json, priority, deadline_at,
		 status, recommended_agent_id, candidates_json, decision_json, confidence, llm_used, requires_review,
		 status_reason, classified_at, recommended_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,`+s.jsonParam()+`,`+s.jsonParam()+`,`+s.jsonParam()+`,?,?,?, ?,`+s.jsonParam()+`,`+s.jsonParam()+`,?,?,0,?,NOW(),NOW())`,
		original.SourceType, original.SourceKey, original.SourceKeyHash, revision, "manual_reassign", "",
		idempotencyKey, original.ID, original.SourceURL, original.TaskTitle, original.TaskBody,
		original.TaskType, original.RequiredRole, original.RequiredCapabilitiesJSON, original.OptionalTagsJSON,
		original.RequiredPermissionsJSON, original.Priority, original.DeadlineAt, TaskDispatchPendingAssignment,
		agentID, fmt.Sprintf(`[{"agent_id":%d}]`, agentID), decisionJSON, original.Confidence, bool01(original.LLMUsed),
		"管理员手动重新分派")
	if err != nil {
		return nil, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	if original.Status == TaskDispatchPendingAssignment {
		_, err = tx.ExecContext(ctx, `UPDATE task_dispatches SET status=?, superseded_by_id=?,
			status_reason=?, finished_at=NOW(), updated_at=NOW(), state_version=state_version+1 WHERE id=?`,
			TaskDispatchSuperseded, newID, "管理员创建了重新分派记录", original.ID)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE task_dispatches SET superseded_by_id=?,
			status_reason=?, updated_at=NOW(), state_version=state_version+1 WHERE id=?`,
			newID, "管理员创建了重新分派记录", original.ID)
	}
	if err != nil {
		return nil, err
	}
	created, err := getTaskDispatchByID(ctx, tx, newID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

// RecordTaskDispatchRecommendation 将分类结果推进到待分派，保留完整决策快照。
func (s *Store) RecordTaskDispatchRecommendation(ctx context.Context, id int64, in TaskDispatchRecommendationInput) (*TaskDispatch, error) {
	if id <= 0 {
		return nil, errors.New("dispatch id required")
	}
	for _, raw := range []*string{
		&in.RequiredCapabilitiesJSON, &in.OptionalTagsJSON, &in.RequiredPermissionsJSON,
		&in.CandidatesJSON, &in.DecisionJSON,
	} {
		if strings.TrimSpace(*raw) == "" {
			*raw = "[]"
		}
	}
	if strings.TrimSpace(in.DecisionJSON) == "[]" {
		in.DecisionJSON = "{}"
	}
	res, err := s.db.ExecContext(ctx, `UPDATE task_dispatches SET
		task_type=?, required_role=?, required_capabilities_json=`+s.jsonParam()+`,
		optional_tags_json=`+s.jsonParam()+`, required_permissions_json=`+s.jsonParam()+`,
		recommended_agent_id=NULLIF(?,0), candidates_json=`+s.jsonParam()+`, decision_json=`+s.jsonParam()+`,
		confidence=?, llm_used=?, status=?, status_reason=?, last_error=NULL,
		classified_at=NOW(), recommended_at=NOW(), updated_at=NOW(), state_version=state_version+1
		WHERE id=? AND status IN (?,?)`,
		strings.TrimSpace(in.TaskType), strings.TrimSpace(in.RequiredRole),
		in.RequiredCapabilitiesJSON, in.OptionalTagsJSON, in.RequiredPermissionsJSON,
		in.RecommendedAgentID, in.CandidatesJSON, in.DecisionJSON,
		in.Confidence, bool01(in.LLMUsed), TaskDispatchPendingAssignment, strings.TrimSpace(in.StatusReason),
		id, TaskDispatchPendingClassification, TaskDispatchPendingAssignment)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		current, getErr := getTaskDispatchByID(ctx, s.db, id)
		if getErr != nil {
			return nil, getErr
		}
		if current == nil {
			return nil, errors.New("dispatch not found")
		}
		return nil, fmt.Errorf("dispatch status conflict: %s", current.Status)
	}
	return getTaskDispatchByID(ctx, s.db, id)
}

// MarkTaskDispatchPendingAssignment 记录可恢复失败，不把 Webhook 或队列错误伪装为已完成。
func (s *Store) MarkTaskDispatchPendingAssignment(ctx context.Context, id int64, reason string, cause error) error {
	lastError := ""
	if cause != nil {
		lastError = cause.Error()
	}
	_, err := s.db.ExecContext(ctx, `UPDATE task_dispatches SET status=?, status_reason=?, last_error=?,
		assigned_agent_id=NULL, queue_task_id=NULL, updated_at=NOW(), state_version=state_version+1
		WHERE id=? AND status IN (?,?)`,
		TaskDispatchPendingAssignment, strings.TrimSpace(reason), lastError, id,
		TaskDispatchPendingClassification, TaskDispatchPendingAssignment)
	return err
}

// EnqueueTaskDispatchAtomic 在同一事务内取得分派权并写入任务队列，避免重复 Webhook 产生两条任务。
// 调用方仍需使用现有 Service 队列锁串行同一 Agent，并在提交后决定是否立即 kickoff。
func (s *Store) EnqueueTaskDispatchAtomic(ctx context.Context, dispatchID, agentID int64, question, attachmentsJSON string) (*AgentTaskQueueItem, error) {
	question = strings.TrimSpace(question)
	if dispatchID <= 0 || agentID <= 0 || question == "" {
		return nil, errors.New("dispatch, agent and question required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var status string
	var requiresReview int
	var existingQueueID sql.NullInt64
	var recommendedAgentID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT status, requires_review, queue_task_id, recommended_agent_id
		FROM task_dispatches WHERE id=?`, dispatchID).
		Scan(&status, &requiresReview, &existingQueueID, &recommendedAgentID); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("dispatch not found")
		}
		return nil, err
	}
	if existingQueueID.Valid && existingQueueID.Int64 > 0 {
		return nil, fmt.Errorf("dispatch already queued: %d", existingQueueID.Int64)
	}
	if status != TaskDispatchPendingAssignment {
		return nil, fmt.Errorf("dispatch status conflict: %s", status)
	}
	if requiresReview != 0 {
		return nil, errors.New("dispatch requires review")
	}
	if !recommendedAgentID.Valid || recommendedAgentID.Int64 != agentID {
		return nil, errors.New("dispatch agent differs from validated recommendation")
	}

	var conversationID int64
	var agentStatus string
	if err := tx.QueryRowContext(ctx, `SELECT IFNULL(conversation_id,0), status FROM managed_agents WHERE id=?`, agentID).
		Scan(&conversationID, &agentStatus); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("agent not found")
		}
		return nil, err
	}
	switch strings.ToLower(strings.TrimSpace(agentStatus)) {
	case "error", "initializing", "disabled", "offline":
		return nil, fmt.Errorf("agent status is not dispatchable: %s", agentStatus)
	}
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_task_queue
		WHERE agent_id=? AND status IN (?,?,?,?)`, agentID, TaskQueued, TaskRunning, TaskExecuting, TaskPaused).Scan(&active); err != nil {
		return nil, err
	}
	if active >= TaskQueueMaxActive {
		return nil, fmt.Errorf("agent task queue full")
	}
	var maxPosition sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT MAX(position) FROM agent_task_queue
		WHERE agent_id=? AND status IN (?,?,?,?)`, agentID, TaskQueued, TaskRunning, TaskExecuting, TaskPaused).Scan(&maxPosition); err != nil {
		return nil, err
	}
	position := 1
	if maxPosition.Valid {
		position = int(maxPosition.Int64) + 1
	}
	ownership, err := tx.ExecContext(ctx, `UPDATE task_dispatches SET status=?, assigned_agent_id=?, confirmed_by='auto-policy',
		confirmed_at=NOW(), updated_at=NOW(), state_version=state_version+1
		WHERE id=? AND status=? AND requires_review=0 AND queue_task_id IS NULL`,
		TaskDispatchDispatching, agentID, dispatchID, TaskDispatchPendingAssignment)
	if err != nil {
		return nil, err
	}
	if n, _ := ownership.RowsAffected(); n != 1 {
		return nil, errors.New("dispatch lost atomic enqueue ownership")
	}

	now := time.Now().UTC()
	var attachments any
	if strings.TrimSpace(attachmentsJSON) != "" {
		attachments = attachmentsJSON
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO agent_task_queue
		(agent_id, conversation_id, status, question, attachments_json, position, pause_rank, error_text, silent_notify, created_at, started_at, finished_at)
		VALUES (?,?,?,?,?,?,NULL,NULL,0,?,NULL,NULL)`,
		agentID, conversationID, TaskQueued, question, attachments, position, now)
	if err != nil {
		return nil, err
	}
	queueID, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	res, err = tx.ExecContext(ctx, `UPDATE task_dispatches SET status=?, queue_task_id=?, queued_at=NOW(),
		updated_at=NOW(), state_version=state_version+1 WHERE id=? AND status=?`,
		TaskDispatchQueued, queueID, dispatchID, TaskDispatchDispatching)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return nil, errors.New("dispatch lost atomic enqueue ownership")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetAgentTaskQueueItem(ctx, queueID)
}

type taskDispatchQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const taskDispatchSelectCols = `id, source_type, source_key, source_key_hash, source_revision,
	event_action, delivery_id, idempotency_key, IFNULL(parent_dispatch_id,0), IFNULL(superseded_by_id,0),
	source_url, task_title, IFNULL(task_body,''), task_type, required_role,
	CAST(required_capabilities_json AS CHAR), CAST(optional_tags_json AS CHAR), CAST(required_permissions_json AS CHAR),
	priority, deadline_at, status, state_version, IFNULL(recommended_agent_id,0), IFNULL(assigned_agent_id,0),
	IFNULL(queue_task_id,0), CAST(candidates_json AS CHAR), CAST(decision_json AS CHAR), confidence,
	llm_used, requires_review, confirmed_by, status_reason, IFNULL(last_error,''), classified_at,
	recommended_at, confirmed_at, queued_at, started_at, finished_at, created_at, updated_at`

func getTaskDispatchByIdempotency(ctx context.Context, q taskDispatchQuerier, key string) (*TaskDispatch, error) {
	return scanTaskDispatch(q.QueryRowContext(ctx, `SELECT `+taskDispatchSelectCols+` FROM task_dispatches WHERE idempotency_key=?`, key))
}

func getTaskDispatchByID(ctx context.Context, q taskDispatchQuerier, id int64) (*TaskDispatch, error) {
	return scanTaskDispatch(q.QueryRowContext(ctx, `SELECT `+taskDispatchSelectCols+` FROM task_dispatches WHERE id=?`, id))
}

func scanTaskDispatch(row *sql.Row) (*TaskDispatch, error) {
	return scanTaskDispatchRow(row)
}

type taskDispatchScanner interface {
	Scan(...any) error
}

func scanTaskDispatchRow(row taskDispatchScanner) (*TaskDispatch, error) {
	var out TaskDispatch
	var deadline, classified, recommended, confirmed, queued, started, finished sql.NullTime
	var llmUsed, requiresReview int
	err := row.Scan(
		&out.ID, &out.SourceType, &out.SourceKey, &out.SourceKeyHash, &out.SourceRevision,
		&out.EventAction, &out.DeliveryID, &out.IdempotencyKey, &out.ParentDispatchID, &out.SupersededByID,
		&out.SourceURL, &out.TaskTitle, &out.TaskBody, &out.TaskType, &out.RequiredRole,
		&out.RequiredCapabilitiesJSON, &out.OptionalTagsJSON, &out.RequiredPermissionsJSON,
		&out.Priority, &deadline, &out.Status, &out.StateVersion, &out.RecommendedAgentID, &out.AssignedAgentID,
		&out.QueueTaskID, &out.CandidatesJSON, &out.DecisionJSON, &out.Confidence,
		&llmUsed, &requiresReview, &out.ConfirmedBy, &out.StatusReason, &out.LastError, &classified,
		&recommended, &confirmed, &queued, &started, &finished, &out.CreatedAt, &out.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out.LLMUsed = llmUsed != 0
	out.RequiresReview = requiresReview != 0
	out.DeadlineAt = nullTimePtr(deadline)
	out.ClassifiedAt = nullTimePtr(classified)
	out.RecommendedAt = nullTimePtr(recommended)
	out.ConfirmedAt = nullTimePtr(confirmed)
	out.QueuedAt = nullTimePtr(queued)
	out.StartedAt = nullTimePtr(started)
	out.FinishedAt = nullTimePtr(finished)
	return &out, nil
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	v := value.Time
	return &v
}

// CanTransitionTaskDispatch 统一约束状态职责，避免接口绕过待确认直接执行。
func CanTransitionTaskDispatch(from, to string) bool {
	allowed := map[string]map[string]bool{
		TaskDispatchPendingClassification: {TaskDispatchPendingAssignment: true, TaskDispatchFailed: true, TaskDispatchCancelled: true, TaskDispatchSuperseded: true},
		TaskDispatchPendingAssignment:     {TaskDispatchPendingConfirmation: true, TaskDispatchDispatching: true, TaskDispatchFailed: true, TaskDispatchCancelled: true, TaskDispatchSuperseded: true},
		TaskDispatchPendingConfirmation:   {TaskDispatchDispatching: true, TaskDispatchCancelled: true, TaskDispatchSuperseded: true},
		TaskDispatchDispatching:           {TaskDispatchQueued: true, TaskDispatchPendingConfirmation: true, TaskDispatchFailed: true},
		TaskDispatchQueued:                {TaskDispatchRunning: true, TaskDispatchFailed: true, TaskDispatchCancelled: true},
		TaskDispatchRunning:               {TaskDispatchCompleted: true, TaskDispatchFailed: true, TaskDispatchCancelled: true},
		TaskDispatchFailed:                {TaskDispatchPendingAssignment: true},
	}
	return allowed[strings.TrimSpace(from)][strings.TrimSpace(to)]
}
