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

const (
	TaskPhasePlanning = "planning"
	TaskPhaseRunning  = "running"
	TaskPhaseDone     = "done"
	TaskPhaseFailed   = "failed"

	TaskStepPending = "pending"
	TaskStepActive  = "active"
	TaskStepDone    = "done"
	TaskStepFailed  = "failed"
	TaskStepSkipped = "skipped"
)

// TaskPlanStep 单步状态（灵动岛可直接展示 title + status）。
type TaskPlanStep struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

// TaskPlanSnapshot 对外稳定快照（Island / API 复用）。
type TaskPlanSnapshot struct {
	Schema         string         `json:"schema"`
	Phase          string         `json:"phase"`
	TaskID         string         `json:"task_id"`
	TaskName       string         `json:"task_name"`
	Steps          []TaskPlanStep `json:"step_items"`
	StepTitles     []string       `json:"steps"` // 兼容旧前端
	CurrentStep    int            `json:"current_step"`
	CompletedCount int            `json:"completed_count"`
	TotalCount     int            `json:"total_count"`
	Progress       int            `json:"progress"`
	Message        string         `json:"message"`
	FailedStep     int            `json:"failed_step,omitempty"`
}

// TaskProgress 管理某轮 Ask 的进度上报(agent_type=managed)。
// 规则：只按真实阶段推进，禁止“一上来跳到中间步”。
type TaskProgress struct {
	svc     *Service
	agentID int64
	taskID  string
	name    string
	phase   string
	steps   []TaskPlanStep
	idx     int
	onEvent AskEventSink
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

// SetPlan 写入拆分结果并激活第 0 步（其余 pending）。
func (tp *TaskProgress) SetPlan(ctx context.Context, titles []string) {
	if tp == nil {
		return
	}
	if len(titles) == 0 {
		titles = HeuristicPlanSteps(tp.name, nil)
	}
	steps := make([]TaskPlanStep, 0, len(titles))
	for i, t := range titles {
		st := TaskStepPending
		if i == 0 {
			st = TaskStepActive
		}
		steps = append(steps, TaskPlanStep{
			ID:     fmt.Sprintf("s%d", i),
			Title:  strings.TrimSpace(t),
			Status: st,
		})
	}
	tp.steps = steps
	tp.idx = 0
	tp.phase = TaskPhaseRunning
	msg := steps[0].Title
	_ = tp.persist(ctx, msg)
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
		return TaskPlanSnapshot{Schema: TaskPlanSchemaV1}
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
	case TaskPhasePlanning:
		prog = 2
	case TaskPhaseDone:
		prog = 100
	case TaskPhaseFailed:
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
		Schema:         TaskPlanSchemaV1,
		Phase:          tp.phase,
		TaskID:         tp.taskID,
		TaskName:       tp.name,
		Steps:          append([]TaskPlanStep(nil), tp.steps...),
		StepTitles:     titles,
		CurrentStep:    tp.idx,
		CompletedCount: completed,
		TotalCount:     total,
		Progress:       prog,
		Message:        message,
	}
	if failedStep >= 0 {
		snap.FailedStep = failedStep
	}
	return snap
}

// ParseTaskPlanSnapshot 从 agent_tasks.payload 解析（灵动岛复用）。
func ParseTaskPlanSnapshot(payload any, fallbackStatus string, fallbackProgress int, fallbackMsg string) TaskPlanSnapshot {
	snap := TaskPlanSnapshot{
		Schema:   TaskPlanSchemaV1,
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
		snap.Phase = TaskPhaseRunning
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
	if v, ok := asInt(m["current_step"]); ok {
		snap.CurrentStep = v
	}
	if v, ok := asInt(m["completed_count"]); ok {
		snap.CompletedCount = v
	}
	if v, ok := asInt(m["total_count"]); ok {
		snap.TotalCount = v
	}
	if items, ok := m["step_items"].([]any); ok {
		for i, raw := range items {
			im, _ := raw.(map[string]any)
			if im == nil {
				continue
			}
			title, _ := im["title"].(string)
			st, _ := im["status"].(string)
			id, _ := im["id"].(string)
			if id == "" {
				id = fmt.Sprintf("s%d", i)
			}
			if st == "" {
				st = TaskStepPending
			}
			snap.Steps = append(snap.Steps, TaskPlanStep{ID: id, Title: title, Status: st})
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
	case TaskPhasePlanning:
		status = "running"
	}
	payload := map[string]any{
		"schema":          snap.Schema,
		"phase":           snap.Phase,
		"steps":           snap.StepTitles,
		"step_items":      snap.Steps,
		"current_step":    snap.CurrentStep,
		"completed_count": snap.CompletedCount,
		"total_count":     snap.TotalCount,
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
