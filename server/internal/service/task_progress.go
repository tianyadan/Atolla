package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/store"
)

// 任务规划状态协议（PC 进度面板 / 灵动岛 / 中继均可复用同一 payload）。
const TaskPlanSchemaV1 = "atolla.task_plan.v1"
const TaskPlanSchemaV2 = "atolla.task_plan.v2"

const (
	TaskPhasePlanning        = "planning"
	TaskPhaseAwaitingConfirm = "awaiting_confirm"
	TaskPhaseRunning         = "running"
	TaskPhasePaused          = "paused"
	TaskPhaseDone            = "done"
	TaskPhaseFailed          = "failed"
	TaskPhaseRejected        = "rejected"
	TaskPhaseAborted         = "aborted"

	TaskStepPending = "pending"
	TaskStepActive  = "active"
	TaskStepDone    = "done"
	TaskStepFailed  = "failed"
	TaskStepSkipped = "skipped"

	// 步骤标题 Unicode rune 硬上限（中英文同一规则）。
	TaskPlanTitleMaxRunes = 6
	TaskPlanMinSteps      = 3
	TaskPlanMaxSteps      = 8
)

// TaskPlanStep 单步状态（灵动岛可直接展示 title + status）。
type TaskPlanStep struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
	Status string `json:"status"`
}

// TaskPlanSnapshot 对外稳定快照（Island / API 复用）。
type TaskPlanSnapshot struct {
	Schema         string         `json:"schema"`
	Phase          string         `json:"phase"`
	TaskID         string         `json:"task_id"`
	TaskName       string         `json:"task_name"`
	Frozen         bool           `json:"frozen"`
	Steps          []TaskPlanStep `json:"step_items"`
	StepTitles     []string       `json:"steps"` // 兼容旧前端
	CurrentStep    int            `json:"current_step"`
	CompletedCount int            `json:"completed_count"`
	TotalCount     int            `json:"total_count"`
	Progress       int            `json:"progress"`
	Message        string         `json:"message"`
	FailedStep     int            `json:"failed_step,omitempty"`
	QueueItemID    int64          `json:"queue_item_id,omitempty"`
}

// TaskProgress 管理某轮 Ask 的进度上报(agent_type=managed)。
// 规则：只按真实阶段推进，禁止“一上来跳到中间步”；确认前 awaiting_confirm，确认后 freeze。
type TaskProgress struct {
	svc         *Service
	agentID     int64
	taskID      string
	name        string
	phase       string
	frozen      bool
	queueItemID int64
	steps       []TaskPlanStep
	idx         int
	onEvent     AskEventSink
}

func (s *Service) beginTaskProgress(ctx context.Context, agentID int64, taskName string, onEvent AskEventSink) *TaskProgress {
	tp := &TaskProgress{
		svc: s, agentID: agentID,
		taskID:  fmt.Sprintf("run-%d-%d", agentID, time.Now().UnixNano()),
		name:    taskName,
		phase:   TaskPhasePlanning,
		idx:     0,
		onEvent: onEvent,
	}
	_ = tp.persist(ctx, "正在拆分任务…")
	return tp
}

// SetPlan 兼容旧调用：写入步骤后进入 running（协作委托等仍用）。
func (tp *TaskProgress) SetPlan(ctx context.Context, titles []string) {
	tp.applyStepTitles(titles, true)
	if tp == nil || len(tp.steps) == 0 {
		return
	}
	tp.phase = TaskPhaseRunning
	tp.frozen = true
	_ = tp.persist(ctx, tp.steps[0].Title)
}

// SetPlanDraft 写入可编辑草稿，进入 awaiting_confirm（不激活执行）。
func (tp *TaskProgress) SetPlanDraft(ctx context.Context, steps []TaskPlanStep) {
	if tp == nil {
		return
	}
	normalized := normalizePlanSteps(steps)
	if len(normalized) == 0 {
		titles := HeuristicPlanSteps(tp.name, nil)
		tp.applyStepTitles(titles, false)
	} else {
		tp.steps = normalized
		tp.idx = 0
	}
	tp.phase = TaskPhaseAwaitingConfirm
	tp.frozen = false
	_ = tp.persist(ctx, "待确认")
}

func (tp *TaskProgress) applyStepTitles(titles []string, activateFirst bool) {
	if tp == nil {
		return
	}
	if len(titles) == 0 {
		titles = HeuristicPlanSteps(tp.name, nil)
	}
	steps := make([]TaskPlanStep, 0, len(titles))
	for i, t := range titles {
		st := TaskStepPending
		if activateFirst && i == 0 {
			st = TaskStepActive
		}
		steps = append(steps, TaskPlanStep{
			ID:     fmt.Sprintf("s%d", i),
			Title:  clampPlanTitle(strings.TrimSpace(t)),
			Status: st,
		})
	}
	tp.steps = normalizePlanSteps(steps)
	tp.idx = 0
}

// ReplaceDraftSteps 仅 awaiting_confirm 且未 freeze 时可替换步骤（用户弹窗编辑）。
func (tp *TaskProgress) ReplaceDraftSteps(ctx context.Context, steps []TaskPlanStep) error {
	if tp == nil {
		return fmt.Errorf("no plan")
	}
	if tp.frozen || tp.phase != TaskPhaseAwaitingConfirm {
		return fmt.Errorf("plan is not editable")
	}
	normalized := normalizePlanSteps(steps)
	if len(normalized) < TaskPlanMinSteps {
		return fmt.Errorf("plan needs at least %d steps", TaskPlanMinSteps)
	}
	tp.steps = normalized
	tp.idx = 0
	_ = tp.persist(ctx, "待确认")
	return nil
}

// Confirm 冻结步骤并进入 running，激活第 0 步。
func (tp *TaskProgress) Confirm(ctx context.Context, steps []TaskPlanStep) error {
	if tp == nil {
		return fmt.Errorf("no plan")
	}
	if tp.phase != TaskPhaseAwaitingConfirm {
		return fmt.Errorf("plan is not awaiting confirm")
	}
	if len(steps) > 0 {
		if err := tp.ReplaceDraftSteps(ctx, steps); err != nil {
			return err
		}
	}
	if len(tp.steps) < TaskPlanMinSteps {
		return fmt.Errorf("plan needs at least %d steps", TaskPlanMinSteps)
	}
	for i := range tp.steps {
		tp.steps[i].Status = TaskStepPending
	}
	tp.steps[0].Status = TaskStepActive
	tp.idx = 0
	tp.frozen = true
	tp.phase = TaskPhaseRunning
	_ = tp.persist(ctx, tp.steps[0].Title)
	return nil
}

// Reject 用户拒绝草稿。
func (tp *TaskProgress) Reject(ctx context.Context) error {
	if tp == nil {
		return fmt.Errorf("no plan")
	}
	if tp.phase != TaskPhaseAwaitingConfirm {
		return fmt.Errorf("plan is not awaiting confirm")
	}
	tp.phase = TaskPhaseRejected
	tp.frozen = true
	_ = tp.persist(ctx, "已放弃本次计划")
	return nil
}

// Pause 中断挂起（手动恢复，不自动续跑）。
func (tp *TaskProgress) Pause(ctx context.Context, msg string) error {
	if tp == nil {
		return fmt.Errorf("no plan")
	}
	if tp.phase != TaskPhaseRunning {
		return fmt.Errorf("plan is not running")
	}
	tp.phase = TaskPhasePaused
	if msg == "" {
		msg = "已暂停"
	}
	_ = tp.persist(ctx, msg)
	return nil
}

// Abort 用户终止整单。
func (tp *TaskProgress) Abort(ctx context.Context) error {
	if tp == nil {
		return fmt.Errorf("no plan")
	}
	if tp.phase != TaskPhaseRunning && tp.phase != TaskPhasePaused {
		return fmt.Errorf("plan cannot abort in phase %s", tp.phase)
	}
	if tp.idx >= 0 && tp.idx < len(tp.steps) && tp.steps[tp.idx].Status == TaskStepActive {
		tp.steps[tp.idx].Status = TaskStepSkipped
	}
	tp.phase = TaskPhaseAborted
	_ = tp.persist(ctx, "用户终止")
	return nil
}

func clampPlanTitle(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= TaskPlanTitleMaxRunes {
		return string(r)
	}
	return string(r[:TaskPlanTitleMaxRunes])
}

func normalizePlanSteps(in []TaskPlanStep) []TaskPlanStep {
	out := make([]TaskPlanStep, 0, len(in))
	for i, st := range in {
		title := clampPlanTitle(st.Title)
		if title == "" {
			continue
		}
		id := strings.TrimSpace(st.ID)
		if id == "" {
			id = fmt.Sprintf("s%d", i)
		}
		status := st.Status
		if status == "" {
			status = TaskStepPending
		}
		out = append(out, TaskPlanStep{
			ID:     id,
			Title:  title,
			Detail: strings.TrimSpace(st.Detail),
			Status: status,
		})
		if len(out) >= TaskPlanMaxSteps {
			break
		}
	}
	return out
}

// Activate 将指定步设为 active（此前未完成的保持原状；仅把目标步标为进行中）。
// 单引擎长跑时应一直停在 0，不要跳到中间。
func (tp *TaskProgress) Activate(ctx context.Context, stepIdx int, msg string) {
	if tp == nil || len(tp.steps) == 0 {
		return
	}
	if stepIdx < 0 {
		stepIdx = 0
	}
	if stepIdx >= len(tp.steps) {
		stepIdx = len(tp.steps) - 1
	}
	// 把 stepIdx 之前仍 active 的收成 done；其后保持 pending
	for i := range tp.steps {
		switch {
		case i < stepIdx:
			if tp.steps[i].Status == TaskStepActive || tp.steps[i].Status == TaskStepPending {
				tp.steps[i].Status = TaskStepDone
			}
		case i == stepIdx:
			if tp.steps[i].Status != TaskStepDone {
				tp.steps[i].Status = TaskStepActive
			}
		default:
			if tp.steps[i].Status == TaskStepActive {
				tp.steps[i].Status = TaskStepPending
			}
		}
	}
	tp.idx = stepIdx
	tp.phase = TaskPhaseRunning
	if msg == "" {
		msg = tp.steps[stepIdx].Title
	}
	_ = tp.persist(ctx, msg)
}

// CompleteThrough 将 0..stepIdx（含）标为 done，并激活下一步（若有）。
func (tp *TaskProgress) CompleteThrough(ctx context.Context, stepIdx int, msg string) {
	if tp == nil || len(tp.steps) == 0 {
		return
	}
	if stepIdx < 0 {
		stepIdx = 0
	}
	if stepIdx >= len(tp.steps) {
		stepIdx = len(tp.steps) - 1
	}
	for i := 0; i <= stepIdx; i++ {
		tp.steps[i].Status = TaskStepDone
	}
	next := stepIdx + 1
	if next < len(tp.steps) {
		tp.steps[next].Status = TaskStepActive
		tp.idx = next
		tp.phase = TaskPhaseRunning
		if msg == "" {
			msg = tp.steps[next].Title
		}
	} else {
		tp.idx = stepIdx
		if msg == "" {
			msg = "已完成"
		}
	}
	_ = tp.persist(ctx, msg)
}

func (tp *TaskProgress) done(ctx context.Context, msg string) {
	if tp == nil {
		return
	}
	for i := range tp.steps {
		if tp.steps[i].Status != TaskStepFailed {
			tp.steps[i].Status = TaskStepDone
		}
	}
	if len(tp.steps) > 0 {
		tp.idx = len(tp.steps) - 1
	}
	tp.phase = TaskPhaseDone
	if msg == "" {
		msg = "已完成"
	}
	_ = tp.persist(ctx, msg)
}

func (tp *TaskProgress) fail(ctx context.Context, msg string) {
	if tp == nil {
		return
	}
	idx := tp.idx
	if idx < 0 {
		idx = 0
	}
	if len(tp.steps) > 0 {
		if idx >= len(tp.steps) {
			idx = len(tp.steps) - 1
		}
		tp.steps[idx].Status = TaskStepFailed
		tp.idx = idx
	}
	tp.phase = TaskPhaseFailed
	if msg == "" {
		msg = "步骤失败"
	}
	_ = tp.persist(ctx, msg)
}

// Snapshot 生成可复用快照（灵动岛/前端）。
func (tp *TaskProgress) Snapshot(message string) TaskPlanSnapshot {
	if tp == nil {
		return TaskPlanSnapshot{Schema: TaskPlanSchemaV2}
	}
	titles := make([]string, len(tp.steps))
	completed := 0
	failedStep := -1
	for i, st := range tp.steps {
		titles[i] = st.Title
		if st.Status == TaskStepDone || st.Status == TaskStepSkipped {
			completed++
		}
		if st.Status == TaskStepFailed {
			failedStep = i
		}
	}
	total := len(tp.steps)
	prog := 0
	switch tp.phase {
	case TaskPhasePlanning, TaskPhaseAwaitingConfirm:
		prog = 2
	case TaskPhasePaused:
		if total > 0 {
			prog = (completed * 100) / total
			if prog < 5 {
				prog = 5
			}
			if prog > 95 {
				prog = 95
			}
		}
	case TaskPhaseDone:
		prog = 100
	case TaskPhaseFailed, TaskPhaseAborted, TaskPhaseRejected:
		if total > 0 {
			prog = (completed * 100) / total
			if prog > 95 {
				prog = 95
			}
		}
	default: // running
		if total > 0 {
			// 进行中的一步不计完成；进度落在已完成比例，最低 5%
			prog = (completed * 100) / total
			if prog < 5 {
				prog = 5
			}
			if prog > 95 {
				prog = 95
			}
		}
	}
	if message == "" && tp.idx >= 0 && tp.idx < len(tp.steps) {
		message = tp.steps[tp.idx].Title
	}
	snap := TaskPlanSnapshot{
		Schema:         TaskPlanSchemaV2,
		Phase:          tp.phase,
		TaskID:         tp.taskID,
		TaskName:       tp.name,
		Frozen:         tp.frozen,
		Steps:          append([]TaskPlanStep(nil), tp.steps...),
		StepTitles:     titles,
		CurrentStep:    tp.idx,
		CompletedCount: completed,
		TotalCount:     total,
		Progress:       prog,
		Message:        message,
		QueueItemID:    tp.queueItemID,
	}
	if failedStep >= 0 {
		snap.FailedStep = failedStep
	}
	return snap
}

// ParseTaskPlanSnapshot 从 agent_tasks.payload 解析（灵动岛复用）。
func ParseTaskPlanSnapshot(payload any, fallbackStatus string, fallbackProgress int, fallbackMsg string) TaskPlanSnapshot {
	snap := TaskPlanSnapshot{
		Schema:   TaskPlanSchemaV2,
		Phase:    TaskPhaseRunning,
		Progress: fallbackProgress,
		Message:  fallbackMsg,
	}
	switch fallbackStatus {
	case "done":
		snap.Phase = TaskPhaseDone
	case "failed":
		snap.Phase = TaskPhaseFailed
	case "waiting":
		snap.Phase = TaskPhaseAwaitingConfirm
	case "paused":
		snap.Phase = TaskPhasePaused
	case "cancelled", "aborted":
		snap.Phase = TaskPhaseAborted
	}
	m, ok := payload.(map[string]any)
	if !ok {
		return snap
	}
	if s, _ := m["schema"].(string); s != "" {
		snap.Schema = s
	}
	if s, _ := m["phase"].(string); s != "" {
		snap.Phase = s
	}
	if b, ok := m["frozen"].(bool); ok {
		snap.Frozen = b
	}
	if v, ok := asInt(m["current_step"]); ok {
		snap.CurrentStep = v
	}
	if v, ok := asInt(m["completed_count"]); ok {
		snap.CompletedCount = v
	}
	if v, ok := asInt(m["total_count"]); ok {
		snap.TotalCount = v
	}
	if v, ok := asInt(m["queue_item_id"]); ok {
		snap.QueueItemID = int64(v)
	}
	if items, ok := m["step_items"].([]any); ok {
		for i, raw := range items {
			im, _ := raw.(map[string]any)
			if im == nil {
				continue
			}
			title, _ := im["title"].(string)
			detail, _ := im["detail"].(string)
			st, _ := im["status"].(string)
			id, _ := im["id"].(string)
			if id == "" {
				id = fmt.Sprintf("s%d", i)
			}
			if st == "" {
				st = TaskStepPending
			}
			snap.Steps = append(snap.Steps, TaskPlanStep{ID: id, Title: title, Detail: detail, Status: st})
			snap.StepTitles = append(snap.StepTitles, title)
		}
	} else if titles, ok := m["steps"].([]any); ok {
		for i, raw := range titles {
			title, _ := raw.(string)
			st := TaskStepPending
			if i < snap.CurrentStep {
				st = TaskStepDone
			} else if i == snap.CurrentStep {
				st = TaskStepActive
			}
			snap.Steps = append(snap.Steps, TaskPlanStep{ID: fmt.Sprintf("s%d", i), Title: title, Status: st})
			snap.StepTitles = append(snap.StepTitles, title)
		}
	}
	snap.TotalCount = len(snap.Steps)
	if snap.Message == "" && snap.CurrentStep >= 0 && snap.CurrentStep < len(snap.Steps) {
		snap.Message = snap.Steps[snap.CurrentStep].Title
	}
	if snap.Progress == 0 && fallbackProgress > 0 {
		snap.Progress = fallbackProgress
	}
	return snap
}

func (tp *TaskProgress) persist(ctx context.Context, msg string) error {
	if tp == nil || tp.svc == nil {
		return nil
	}
	snap := tp.Snapshot(msg)
	status := "running"
	switch tp.phase {
	case TaskPhaseDone:
		status = "done"
	case TaskPhaseFailed:
		status = "failed"
	case TaskPhaseAwaitingConfirm:
		status = "waiting"
	case TaskPhasePaused:
		status = "paused"
	case TaskPhaseRejected, TaskPhaseAborted:
		status = "cancelled"
	case TaskPhasePlanning:
		status = "running"
	}
	payload := map[string]any{
		"schema":          snap.Schema,
		"phase":           snap.Phase,
		"frozen":          snap.Frozen,
		"steps":           snap.StepTitles,
		"step_items":      snap.Steps,
		"current_step":    snap.CurrentStep,
		"completed_count": snap.CompletedCount,
		"total_count":     snap.TotalCount,
	}
	if snap.QueueItemID > 0 {
		payload["queue_item_id"] = snap.QueueItemID
	}
	if tp.phase == TaskPhaseFailed {
		payload["failed"] = true
		payload["failed_step"] = snap.CurrentStep
	}
	_, err := tp.svc.Store.UpsertAgentTask(ctx, store.AgentTaskReport{
		AgentType: "managed",
		AgentID:   strconv.FormatInt(tp.agentID, 10),
		TaskID:    tp.taskID,
		TaskName:  tp.name,
		Status:    status,
		Progress:  snap.Progress,
		Message:   snap.Message,
		Payload:   payload,
	})
	emitAsk(tp.onEvent, map[string]any{
		"type":     "task_plan",
		"task_id":  tp.taskID,
		"phase":    snap.Phase,
		"frozen":   snap.Frozen,
		"steps":    snap.StepTitles,
		"progress": snap.Progress,
		"message":  snap.Message,
		"payload":  payload,
	})
	// 兼容旧前端监听 task_progress
	emitAsk(tp.onEvent, map[string]any{
		"type":     "task_progress",
		"task_id":  tp.taskID,
		"phase":    snap.Phase,
		"steps":    snap.StepTitles,
		"progress": snap.Progress,
		"message":  snap.Message,
		"payload":  payload,
	})
	return err
}

// 兼容旧调用名
func (tp *TaskProgress) advance(ctx context.Context, stepIdx int, msg string) {
	tp.Activate(ctx, stepIdx, msg)
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case float32:
		return int(n), true
	case string:
		i, err := strconv.Atoi(n)
		return i, err == nil
	default:
		return 0, false
	}
}

func truncateRunTitle(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return "数字员工任务"
	}
	return truncateRunes(q, 40)
}
