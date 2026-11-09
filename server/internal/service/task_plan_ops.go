package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/store"
)

const taskPlanQueueMarker = "__atolla_task_plan__:"

// EncodePlanQueueQuestion 队列原子项文案：标记 + plan_id + 标题。
func EncodePlanQueueQuestion(planID, taskName string) string {
	planID = strings.TrimSpace(planID)
	taskName = strings.TrimSpace(taskName)
	if taskName == "" {
		taskName = "任务计划"
	}
	return taskPlanQueueMarker + planID + "\n" + taskName
}

// ParsePlanQueueQuestion 解析队列项是否为 Plan 原子任务。
func ParsePlanQueueQuestion(question string) (planID, title string, ok bool) {
	q := strings.TrimSpace(question)
	if !strings.HasPrefix(q, taskPlanQueueMarker) {
		return "", "", false
	}
	rest := strings.TrimPrefix(q, taskPlanQueueMarker)
	parts := strings.SplitN(rest, "\n", 2)
	planID = strings.TrimSpace(parts[0])
	if planID == "" {
		return "", "", false
	}
	if len(parts) > 1 {
		title = strings.TrimSpace(parts[1])
	}
	return planID, title, true
}

// IsPlanQueueItem 队列项是否为不可普通删除的 Plan。
func IsPlanQueueItem(it *store.AgentTaskQueueItem) bool {
	if it == nil {
		return false
	}
	_, _, ok := ParsePlanQueueQuestion(it.Question)
	return ok
}

// ActiveTaskPlanView 对外活跃计划视图。
type ActiveTaskPlanView struct {
	PlanID      string         `json:"plan_id"`
	Phase       string         `json:"phase"`
	Frozen      bool           `json:"frozen"`
	TaskName    string         `json:"task_name"`
	Progress    int            `json:"progress"`
	Message     string         `json:"message"`
	CurrentStep int            `json:"current_step"`
	TotalCount  int            `json:"total_count"`
	Steps       []TaskPlanStep `json:"step_items"`
	QueueItemID int64          `json:"queue_item_id,omitempty"`
}

// LookupActiveTaskPlan 读取 agent 当前活跃计划（waiting/running/paused）。
func (s *Service) LookupActiveTaskPlan(ctx context.Context, agentID int64) (*ActiveTaskPlanView, error) {
	tp, err := s.loadActiveTaskProgress(ctx, agentID, "")
	if err != nil || tp == nil {
		return nil, err
	}
	snap := tp.Snapshot("")
	return snapshotToView(snap), nil
}

func snapshotToView(snap TaskPlanSnapshot) *ActiveTaskPlanView {
	return &ActiveTaskPlanView{
		PlanID:      snap.TaskID,
		Phase:       snap.Phase,
		Frozen:      snap.Frozen,
		TaskName:    snap.TaskName,
		Progress:    snap.Progress,
		Message:     snap.Message,
		CurrentStep: snap.CurrentStep,
		TotalCount:  snap.TotalCount,
		Steps:       snap.Steps,
		QueueItemID: snap.QueueItemID,
	}
}

func (s *Service) loadActiveTaskProgress(ctx context.Context, agentID int64, planID string) (*TaskProgress, error) {
	if s == nil || s.Store == nil || agentID <= 0 {
		return nil, fmt.Errorf("invalid agent")
	}
	tasks, err := s.Store.AgentTasks(ctx, "managed", "")
	if err != nil {
		return nil, err
	}
	aid := strconv.FormatInt(agentID, 10)
	var best *store.AgentTask
	for i := range tasks {
		t := &tasks[i]
		if strings.TrimSpace(t.AgentID) != aid {
			continue
		}
		if planID != "" && t.TaskID != planID {
			continue
		}
		st := strings.ToLower(strings.TrimSpace(t.Status))
		if st != "waiting" && st != "running" && st != "paused" {
			continue
		}
		best = t
		break // AgentTasks 已按 updated_at DESC
	}
	if best == nil {
		return nil, nil
	}
	return s.taskProgressFromRow(best), nil
}

func (s *Service) taskProgressFromRow(t *store.AgentTask) *TaskProgress {
	snap := ParseTaskPlanSnapshot(t.Payload, t.Status, t.Progress, t.Message)
	if snap.TaskID == "" {
		snap.TaskID = t.TaskID
	}
	if snap.TaskName == "" {
		snap.TaskName = t.TaskName
	}
	agentID, _ := strconv.ParseInt(strings.TrimSpace(t.AgentID), 10, 64)
	tp := &TaskProgress{
		svc:         s,
		agentID:     agentID,
		taskID:      snap.TaskID,
		name:        snap.TaskName,
		phase:       snap.Phase,
		frozen:      snap.Frozen,
		queueItemID: snap.QueueItemID,
		steps:       append([]TaskPlanStep(nil), snap.Steps...),
		idx:         snap.CurrentStep,
	}
	if tp.phase == "" {
		switch strings.ToLower(t.Status) {
		case "waiting":
			tp.phase = TaskPhaseAwaitingConfirm
		case "paused":
			tp.phase = TaskPhasePaused
		default:
			tp.phase = TaskPhaseRunning
		}
	}
	return tp
}

// ConfirmTaskPlanSteps 用户确认（可带编辑后的 steps）→ 冻结 → 入队原子项 → 逐步执行。
func (s *Service) ConfirmTaskPlanSteps(ctx context.Context, agentID int64, planID string, steps []TaskPlanStep) (*ActiveTaskPlanView, error) {
	tp, err := s.loadActiveTaskProgress(ctx, agentID, planID)
	if err != nil {
		return nil, err
	}
	if tp == nil {
		return nil, fmt.Errorf("plan not found")
	}
	if err := tp.Confirm(ctx, steps); err != nil {
		return nil, err
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return nil, fmt.Errorf("agent not found")
	}
	q := EncodePlanQueueQuestion(tp.taskID, tp.name)
	pos, _ := s.Store.NextAgentTaskPosition(ctx, agentID)
	now := time.Now()
	id, err := s.Store.InsertAgentTaskQueue(ctx, store.AgentTaskQueueItem{
		AgentID:        agentID,
		ConversationID: a.ConversationID,
		Status:         store.TaskRunning,
		Question:       q,
		Position:       pos,
		CreatedAt:      now,
		StartedAt:      &now,
	})
	if err != nil {
		return nil, err
	}
	tp.queueItemID = id
	_ = tp.persist(ctx, tp.steps[0].Title)

	// 原子切到 executing 后逐步跑
	if _, berr := s.Store.BeginAgentTaskExecution(ctx, id); berr != nil {
		log.Printf("task plan confirm begin exec: %v", berr)
	}
	go s.runConfirmedTaskPlan(agentID, tp.taskID, id)
	s.PushAgentsMirrorNow()
	return snapshotToView(tp.Snapshot("")), nil
}

// RejectTaskPlanDraft 拒绝草稿。
func (s *Service) RejectTaskPlanDraft(ctx context.Context, agentID int64, planID string) error {
	tp, err := s.loadActiveTaskProgress(ctx, agentID, planID)
	if err != nil {
		return err
	}
	if tp == nil {
		return fmt.Errorf("plan not found")
	}
	if err := tp.Reject(ctx); err != nil {
		return err
	}
	s.PushAgentsMirrorNow()
	return nil
}

// AbortTaskPlanRun 终止执行中/暂停中的计划。
func (s *Service) AbortTaskPlanRun(ctx context.Context, agentID int64, planID string) error {
	tp, err := s.loadActiveTaskProgress(ctx, agentID, planID)
	if err != nil {
		return err
	}
	if tp == nil {
		return fmt.Errorf("plan not found")
	}
	s.StopManaged(agentID)
	if err := tp.Abort(ctx); err != nil {
		return err
	}
	if tp.queueItemID > 0 {
		if completed, _ := s.Store.CompleteAgentTaskRunning(ctx, tp.queueItemID, store.TaskCancelled, "用户终止计划"); completed {
			s.writeBackGitHubIdeaTask(tp.queueItemID, store.TaskCancelled, "用户终止计划")
		}
	}
	s.PushAgentsMirrorNow()
	return nil
}

// ResumeTaskPlanRun 手动继续暂停的计划。
func (s *Service) ResumeTaskPlanRun(ctx context.Context, agentID int64, planID string) error {
	tp, err := s.loadActiveTaskProgress(ctx, agentID, planID)
	if err != nil {
		return err
	}
	if tp == nil {
		return fmt.Errorf("plan not found")
	}
	if tp.phase != TaskPhasePaused {
		return fmt.Errorf("plan is not paused")
	}
	tp.phase = TaskPhaseRunning
	if tp.idx >= 0 && tp.idx < len(tp.steps) {
		tp.steps[tp.idx].Status = TaskStepActive
	}
	_ = tp.persist(ctx, "继续执行")
	qid := tp.queueItemID
	if qid > 0 {
		// 若仍为 paused，尝试改回 running 再派发
		it, _ := s.Store.GetAgentTaskQueueItem(ctx, qid)
		if it != nil && it.Status == store.TaskPaused {
			_, _ = s.Store.BeginAgentTaskExecution(ctx, qid)
		}
	}
	go s.runConfirmedTaskPlan(agentID, tp.taskID, qid)
	s.PushAgentsMirrorNow()
	return nil
}

// HasBlockingTaskPlan 是否有未确认/执行中/暂停的计划（阻止新开 Plan 或需入队）。
func (s *Service) HasBlockingTaskPlan(ctx context.Context, agentID int64) (phase string, ok bool) {
	tp, err := s.loadActiveTaskProgress(ctx, agentID, "")
	if err != nil || tp == nil {
		return "", false
	}
	switch tp.phase {
	case TaskPhaseAwaitingConfirm, TaskPhasePlanning, TaskPhaseRunning, TaskPhasePaused:
		return tp.phase, true
	default:
		return "", false
	}
}

// runConfirmedTaskPlan 按冻结步骤逐步执行（每步一次 skipTaskPlan Ask）。
func (s *Service) runConfirmedTaskPlan(agentID int64, planID string, queueItemID int64) {
	ctx := context.Background()
	tp, err := s.loadActiveTaskProgress(ctx, agentID, planID)
	if err != nil || tp == nil {
		log.Printf("task plan run: load failed agent=%d: %v", agentID, err)
		return
	}
	if queueItemID > 0 {
		tp.queueItemID = queueItemID
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return
	}

	for i := tp.idx; i < len(tp.steps); i++ {
		// 每步前重载，支持中途 Abort/Pause
		fresh, _ := s.loadActiveTaskProgress(ctx, agentID, planID)
		if fresh == nil || fresh.phase == TaskPhaseAborted || fresh.phase == TaskPhaseFailed {
			return
		}
		if fresh.phase == TaskPhasePaused {
			return
		}
		tp = fresh
		tp.Activate(ctx, i, tp.steps[i].Title)
		s.PushAgentsMirrorNow()

		step := tp.steps[i]
		q := fmt.Sprintf(
			"【任务计划 步骤 %d/%d：%s】\n%s\n\n请只完成这一步，完成后用两三句话汇报结果。不要修改计划步骤本身。",
			i+1, len(tp.steps), step.Title, strings.TrimSpace(step.Detail),
		)
		_, askErr := s.askManagedCore(ctx, a, 0, q, askCoreOpts{
			bindMainConv: true,
			skipTaskPlan: true,
			holdStatus:   false,
			agentAudit:   &agentAskAudit{Source: store.AgentAskSourceMobile},
		}, nil)
		fresh2, _ := s.loadActiveTaskProgress(ctx, agentID, planID)
		if fresh2 == nil {
			return
		}
		tp = fresh2
		if askErr != nil {
			tp.fail(ctx, askErr.Error())
			if queueItemID > 0 {
				if completed, _ := s.Store.CompleteAgentTaskRunning(ctx, queueItemID, store.TaskFailed, askErr.Error()); completed {
					s.writeBackGitHubIdeaTask(queueItemID, store.TaskFailed, askErr.Error())
				}
			}
			s.PushAgentsMirrorNow()
			return
		}
		if tp.phase == TaskPhaseAborted || tp.phase == TaskPhasePaused {
			return
		}
		tp.CompleteThrough(ctx, i, "")
		s.PushAgentsMirrorNow()
	}

	fresh, _ := s.loadActiveTaskProgress(ctx, agentID, planID)
	if fresh != nil && fresh.phase == TaskPhaseRunning {
		fresh.done(ctx, "已完成")
	}
	if queueItemID > 0 {
		if completed, _ := s.Store.CompleteAgentTaskRunning(ctx, queueItemID, store.TaskDone, ""); completed {
			s.writeBackGitHubIdeaTask(queueItemID, store.TaskDone, "")
		}
	}
	s.PushAgentsMirrorNow()
	// 计划跑完后尝试续跑普通队列
	if next, _ := s.FinishAgentTaskAndPeekNext(ctx, agentID, 0, true, ""); next != nil {
		go s.autoRunClaimedTaskQueueItem(agentID, next)
	}
}

// PushTaskPlanAwaitingBark 待确认计划 Bark（对齐审批通知）。
func (s *Service) PushTaskPlanAwaitingBark(agentID int64, planID, taskName string) bool {
	planID = strings.TrimSpace(planID)
	if planID == "" {
		return false
	}
	name, department, _ := s.barkAgentIdentity(context.Background(), agentID)
	body := strings.TrimSpace(taskName)
	if body == "" {
		body = "有任务计划待确认"
	}
	return s.PushBarkIfAllowed(agentID, "task_plan:"+planID, name+"｜"+department+"\n计划待确认："+body)
}

// parseStepsFromConfirmPayload 解析前端提交的 steps。
func parseStepsFromConfirmPayload(raw any) []TaskPlanStep {
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var steps []TaskPlanStep
	if json.Unmarshal(b, &steps) == nil && len(steps) > 0 {
		return steps
	}
	var maps []map[string]any
	if json.Unmarshal(b, &maps) != nil {
		return nil
	}
	for i, m := range maps {
		title, _ := m["title"].(string)
		detail, _ := m["detail"].(string)
		id, _ := m["id"].(string)
		if id == "" {
			id = fmt.Sprintf("s%d", i)
		}
		steps = append(steps, TaskPlanStep{ID: id, Title: title, Detail: detail, Status: TaskStepPending})
	}
	return steps
}
