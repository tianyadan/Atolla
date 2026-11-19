package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"

	"atolla/server/internal/store"
)

const taskQueueResumePrefix = "（系统）上一轮执行被紧急任务打断，请根据最新对话完整重新完成本任务，避免重复已完成的副作用。\n\n"

var (
	ErrTaskQueueFull       = errors.New("任务队列已满（最多 20 条活跃）")
	ErrTaskQueuePauseFull  = errors.New("打断次数过多，请先处理紧急任务或终止")
	ErrTaskQueueLocked     = errors.New("数字人正被项目协作占用，请稍后再打断")
	ErrTaskQueueDispatched = errors.New("任务已开始或已完成，请勿重复发送")
	errTaskQueueEmptyQ     = errors.New("question required")
)

// taskQueueLocks 按 agent 串行调度。
type taskQueueLocks struct {
	mu    sync.Mutex
	locks map[int64]*sync.Mutex
}

func (t *taskQueueLocks) lock(agentID int64) func() {
	t.mu.Lock()
	if t.locks == nil {
		t.locks = map[int64]*sync.Mutex{}
	}
	m, ok := t.locks[agentID]
	if !ok {
		m = &sync.Mutex{}
		t.locks[agentID] = m
	}
	t.mu.Unlock()
	m.Lock()
	return m.Unlock
}

func (s *Service) taskQueueLock(agentID int64) func() {
	// Webhook 可能并发首次触发，使用 Once 避免队列锁容器初始化竞态。
	s.tqLocksOnce.Do(func() {
		if s.tqLocks == nil {
			s.tqLocks = &taskQueueLocks{}
		}
	})
	return s.tqLocks.lock(agentID)
}

// TaskQueueAttachment 入队附件（已上传）。
type TaskQueueAttachment struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Mime string `json:"mime"`
	Name string `json:"name"`
}

// TaskQueueItemView 队列项 + 可选 Plan 展开快照。
type TaskQueueItemView struct {
	store.AgentTaskQueueItem
	Kind   string              `json:"kind,omitempty"` // task_plan | ""
	PlanID string              `json:"plan_id,omitempty"`
	Plan   *ActiveTaskPlanView `json:"plan,omitempty"`
	Locked bool                `json:"locked,omitempty"` // Plan 不可普通删改
}

// TaskQueueView 列表 API 视图。
type TaskQueueView struct {
	Items  []TaskQueueItemView `json:"items"`
	Hold   bool                `json:"hold"`
	Active int                 `json:"active"`
}

// ListTaskQueue 读取队列轨数据。
func (s *Service) ListTaskQueue(ctx context.Context, agentID int64) (TaskQueueView, error) {
	items, err := s.Store.ListAgentTaskQueue(ctx, agentID, store.TaskQueueDoneKeep)
	if err != nil {
		return TaskQueueView{}, err
	}
	hold, _ := s.Store.GetAgentTaskQueueHold(ctx, agentID)
	active, _ := s.Store.CountAgentTaskActive(ctx, agentID)
	if items == nil {
		items = []store.AgentTaskQueueItem{}
	}
	out := make([]TaskQueueItemView, 0, len(items))
	for i := range items {
		it := items[i]
		if it.Status == store.TaskExecuting {
			it.Status = store.TaskRunning
		}
		row := TaskQueueItemView{AgentTaskQueueItem: it}
		if planID, title, ok := ParsePlanQueueQuestion(it.Question); ok {
			row.Kind = "task_plan"
			row.PlanID = planID
			row.Locked = true
			if title != "" {
				row.Question = "计划 · " + title
			} else {
				row.Question = "计划 · 任务计划"
			}
			if view, _ := s.LookupActiveTaskPlan(ctx, agentID); view != nil && view.PlanID == planID {
				row.Plan = view
			}
		}
		out = append(out, row)
	}
	return TaskQueueView{Items: out, Hold: hold, Active: active}, nil
}

// beginTaskQueueExecution 校验任务归属并原子取得唯一派发权。
func (s *Service) beginTaskQueueExecution(ctx context.Context, agentID, taskID int64) (*store.AgentTaskQueueItem, error) {
	it, err := s.Store.GetAgentTaskQueueItem(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if it == nil || it.AgentID != agentID {
		return nil, fmt.Errorf("task not found")
	}
	started, err := s.Store.BeginAgentTaskExecution(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if !started {
		return nil, ErrTaskQueueDispatched
	}
	it.Status = store.TaskExecuting
	return it, nil
}

// EnqueueOutcome 入队结果；Kickoff 表示空闲时已 claim、需立刻 Ask 的项（可能是新入队或更早的排队项）。
type EnqueueOutcome struct {
	Item    *store.AgentTaskQueueItem
	Kickoff *store.AgentTaskQueueItem
}

// EnqueueAgentTask 追加到队列末尾（不停当前）。
// 若数字人已空闲且未 hold：claim 队首并返回 Kickoff，避免「入队踩在回合收尾后」永远不跑。
func (s *Service) EnqueueAgentTask(ctx context.Context, agentID int64, question string, atts []TaskQueueAttachment) (*store.AgentTaskQueueItem, error) {
	out, err := s.EnqueueAgentTaskEx(ctx, agentID, question, atts)
	if err != nil {
		return nil, err
	}
	return out.Item, nil
}

// EnqueueAgentTaskEx 同 EnqueueAgentTask，额外返回是否需立刻开跑。
func (s *Service) EnqueueAgentTaskEx(ctx context.Context, agentID int64, question string, atts []TaskQueueAttachment) (EnqueueOutcome, error) {
	question = strings.TrimSpace(question)
	if question == "" && len(atts) == 0 {
		return EnqueueOutcome{}, errTaskQueueEmptyQ
	}
	unlock := s.taskQueueLock(agentID)
	defer unlock()

	active, err := s.Store.CountAgentTaskActive(ctx, agentID)
	if err != nil {
		return EnqueueOutcome{}, err
	}
	if active >= store.TaskQueueMaxActive {
		return EnqueueOutcome{}, ErrTaskQueueFull
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return EnqueueOutcome{}, fmt.Errorf("agent not found")
	}
	pos, err := s.Store.NextAgentTaskPosition(ctx, agentID)
	if err != nil {
		return EnqueueOutcome{}, err
	}
	attJSON, err := marshalTaskAtts(atts)
	if err != nil {
		return EnqueueOutcome{}, err
	}
	id, err := s.Store.InsertAgentTaskQueue(ctx, store.AgentTaskQueueItem{
		AgentID:         agentID,
		ConversationID:  a.ConversationID,
		Status:          store.TaskQueued,
		Question:        question,
		AttachmentsJSON: attJSON,
		Position:        pos,
	})
	if err != nil {
		return EnqueueOutcome{}, err
	}
	item, err := s.Store.GetAgentTaskQueueItem(ctx, id)
	if err != nil {
		return EnqueueOutcome{}, err
	}
	kickoff := s.claimNextIfIdleLocked(ctx, agentID)
	if kickoff != nil && item != nil && kickoff.ID == item.ID {
		item = kickoff
	}
	return EnqueueOutcome{Item: item, Kickoff: kickoff}, nil
}

// claimNextIfIdleLocked 调用方须已持有 taskQueueLock。
func (s *Service) claimNextIfIdleLocked(ctx context.Context, agentID int64) *store.AgentTaskQueueItem {
	hold, _ := s.Store.GetAgentTaskQueueHold(ctx, agentID)
	if hold {
		return nil
	}
	s.runMu.Lock()
	_, live := s.runs[agentID]
	s.runMu.Unlock()
	if live {
		return nil
	}
	if cur, _ := s.Store.GetRunningAgentTask(ctx, agentID); cur != nil {
		return nil
	}
	if next, _ := s.Store.ClaimPausedAgentTask(ctx, agentID); next != nil {
		return next
	}
	next, _ := s.Store.ClaimQueuedAgentTask(ctx, agentID)
	return next
}

// InterruptPreferAgentTask 打断当前执行并立刻让位给调用方直发 Ask。
// 不入队、不暂停：当前 running 标 cancelled；仅「加入队列」才写 queued。
func (s *Service) InterruptPreferAgentTask(ctx context.Context, agentID int64, question string, atts []TaskQueueAttachment) (*store.AgentTaskQueueItem, error) {
	question = strings.TrimSpace(question)
	if question == "" && len(atts) == 0 {
		return nil, errTaskQueueEmptyQ
	}
	unlock := s.taskQueueLock(agentID)
	defer unlock()

	if a, err := s.Store.GetManagedAgent(ctx, agentID); err != nil || a == nil {
		return nil, fmt.Errorf("agent not found")
	}
	occ, _ := s.Store.GetOccupancy(ctx, agentID)
	if OccupancyBlocksUserChat(occ) {
		return nil, ErrTaskQueueLocked
	}
	running, err := s.Store.GetRunningAgentTask(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if running != nil {
		// 打断=放弃当前队列表项，不paused进轨，避免用户以为「插话进了队列」。
		completed, err := s.Store.CompleteAgentTaskRunning(ctx, running.ID, store.TaskCancelled, "interrupted by user")
		if err != nil {
			return nil, err
		}
		if completed {
			s.writeBackGitHubIdeaTask(running.ID, store.TaskCancelled, "interrupted by user")
		}
	}
	// 停引擎；不 hold，便于后续仍可续跑用户此前主动入队的项。
	s.stopManagedForInterrupt(agentID)
	_ = s.Store.SetAgentTaskQueueHold(ctx, agentID, false)
	return nil, nil
}

// FinishAgentTaskAndPeekNext Ask 结束后幂等收尾；若未 hold 则 claim 下一条（不自动开跑）。
// taskID==0 表示普通直发：不写/不改队列表；仅在无 running 时尝试出队（用户忙时入队的后续项）。
func (s *Service) FinishAgentTaskAndPeekNext(ctx context.Context, agentID, taskID int64, ok bool, errText string) (*store.AgentTaskQueueItem, error) {
	unlock := s.taskQueueLock(agentID)
	defer unlock()

	status := store.TaskDone
	if !ok {
		status = store.TaskFailed
	}
	if taskID > 0 {
		completed, err := s.Store.CompleteAgentTaskRunning(ctx, taskID, status, errText)
		if err != nil {
			return nil, err
		}
		// 已被打断标为 paused / 被 Stop 取消：不要出队，避免与紧急 running 双开
		if !completed {
			return nil, nil
		}
		// GitHub Idea 任务在统一终态点回写 Markdown；非插件任务没有绑定，会被快速忽略。
		s.writeBackGitHubIdeaTask(taskID, status, errText)
	}
	// 注意：taskID==0 时禁止 Complete「当前 running」——打断直发后紧急任务已是 running，误收尾会毁掉它

	hold, _ := s.Store.GetAgentTaskQueueHold(ctx, agentID)
	if hold {
		return nil, nil
	}
	// 仍有 running（例如打断刚插入的紧急项）则不出队
	if cur, _ := s.Store.GetRunningAgentTask(ctx, agentID); cur != nil {
		return nil, nil
	}
	// waiting 审批：若仍 busy 由调用方保证不调用本方法；此处仅调度
	next, err := s.Store.ClaimPausedAgentTask(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if next != nil {
		return next, nil
	}
	return s.Store.ClaimQueuedAgentTask(ctx, agentID)
}

// ContinueAgentTaskQueue 用户点「继续队列」：清 hold 并 claim 下一条。
func (s *Service) ContinueAgentTaskQueue(ctx context.Context, agentID int64) (*store.AgentTaskQueueItem, error) {
	unlock := s.taskQueueLock(agentID)
	defer unlock()

	occ, _ := s.Store.GetOccupancy(ctx, agentID)
	if OccupancyBlocksUserChat(occ) {
		return nil, ErrTaskQueueLocked
	}
	if cur, _ := s.Store.GetRunningAgentTask(ctx, agentID); cur != nil {
		// executing 已由某个请求接管；继续按钮不得再次派发。running 则允许恢复尚未送达的领取项。
		if cur.Status == store.TaskExecuting {
			return nil, nil
		}
		return cur, nil
	}
	_ = s.Store.SetAgentTaskQueueHold(ctx, agentID, false)
	next, err := s.Store.ClaimPausedAgentTask(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if next != nil {
		return next, nil
	}
	return s.Store.ClaimQueuedAgentTask(ctx, agentID)
}

// CancelAgentTaskQueueItem 取消 queued/paused。Plan 原子项不可普通取消。
func (s *Service) CancelAgentTaskQueueItem(ctx context.Context, agentID, taskID int64) error {
	unlock := s.taskQueueLock(agentID)
	defer unlock()
	it, err := s.Store.GetAgentTaskQueueItem(ctx, taskID)
	if err != nil {
		return err
	}
	if IsPlanQueueItem(it) {
		return fmt.Errorf("计划任务不可删除，请使用终止计划")
	}
	ok, err := s.Store.CancelAgentTask(ctx, agentID, taskID)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("task not cancellable")
	}
	s.writeBackGitHubIdeaTask(taskID, store.TaskCancelled, "cancelled by user")
	return nil
}

// UpdateAgentTaskQueueQuestion 改写未执行项（queued/paused）问题文案。Plan 原子项不可改。
func (s *Service) UpdateAgentTaskQueueQuestion(ctx context.Context, agentID, taskID int64, question string) error {
	question = strings.TrimSpace(question)
	if question == "" {
		return errTaskQueueEmptyQ
	}
	unlock := s.taskQueueLock(agentID)
	defer unlock()
	it, err := s.Store.GetAgentTaskQueueItem(ctx, taskID)
	if err != nil {
		return err
	}
	if IsPlanQueueItem(it) {
		return fmt.Errorf("计划任务不可编辑文案")
	}
	ok, err := s.Store.UpdateAgentTaskQuestion(ctx, agentID, taskID, question)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("task not editable")
	}
	return nil
}

// ClearAgentTaskQueueDone 清除终态展示。
func (s *Service) ClearAgentTaskQueueDone(ctx context.Context, agentID int64) error {
	_, err := s.Store.ClearAgentTaskDone(ctx, agentID)
	return err
}

// RepairAgentTaskQueueOnBoot 假 running → paused，并 hold（不自动跑）。
func (s *Service) RepairAgentTaskQueueOnBoot(ctx context.Context) {
	n, agentIDs, err := s.Store.DemoteRunningAgentTasksToPaused(ctx)
	if err != nil {
		log.Printf("task queue boot repair: %v", err)
		return
	}
	for _, id := range agentIDs {
		_ = s.Store.SetAgentTaskQueueHold(ctx, id, true)
	}
	if n > 0 {
		log.Printf("task queue: demoted %d running -> paused on %d agents (held until continue)", n, len(agentIDs))
	}
}

// autoRunClaimedTaskQueueItem 无 SSE 客户端时由服务端串行续跑（手机入队链）。
func (s *Service) autoRunClaimedTaskQueueItem(agentID int64, next *store.AgentTaskQueueItem) {
	if next == nil || next.ID <= 0 {
		return
	}
	// Plan 原子项：走逐步执行，不把标记文案当用户提问。
	if planID, _, ok := ParsePlanQueueQuestion(next.Question); ok {
		go s.runConfirmedTaskPlan(agentID, planID, next.ID)
		return
	}
	atts := TaskQueueAttsToChat(ParseTaskQueueAttachments(next.AttachmentsJSON))
	_, err := s.askManagedUserFacing(context.Background(), agentID, next.Question, atts, store.AgentAskSourceMobile, nil, AskUserFacingOpts{
		TaskID:       next.ID,
		ResumePrefix: next.ResumeHint,
	})
	if err != nil {
		log.Printf("task queue auto-run agent=%d task=%d: %v", agentID, next.ID, err)
	}
	if s.RemoteBridge != nil {
		s.RemoteBridge.PushAgentMessagesSnapshot(agentID)
	}
}

// BuildTaskQueueAskQuestion resume 时加系统前缀。
func BuildTaskQueueAskQuestion(it *store.AgentTaskQueueItem, resumedFromPause bool) string {
	q := ""
	if it != nil {
		q = it.Question
	}
	if resumedFromPause {
		return taskQueueResumePrefix + q
	}
	return q
}

// ParseTaskQueueAttachments 从 JSON 解析附件。
func ParseTaskQueueAttachments(raw string) []TaskQueueAttachment {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var atts []TaskQueueAttachment
	if err := json.Unmarshal([]byte(raw), &atts); err != nil {
		return nil
	}
	return atts
}

func marshalTaskAtts(atts []TaskQueueAttachment) (string, error) {
	if len(atts) == 0 {
		return "", nil
	}
	b, err := json.Marshal(atts)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// stopManagedForInterrupt 停引擎但不 cancelled 队列、不设 hold。
func (s *Service) stopManagedForInterrupt(agentID int64) {
	s.runMu.Lock()
	slot, ok := s.runs[agentID]
	if ok {
		delete(s.runs, agentID)
	}
	s.runMu.Unlock()
	if ok && slot != nil {
		slot.cancel()
	}
	s.ReleaseOccupancy(context.Background(), agentID)
}

// StopManagedAndHoldQueue 用户点终止：先 hold 再杀进程，避免收尾竞态又 claim 下一条。
func (s *Service) StopManagedAndHoldQueue(agentID int64) bool {
	ctx := context.Background()
	unlock := s.taskQueueLock(agentID)
	// 必须先 hold：Ask 收尾的 FinishAgentTaskAndPeekNext 会读 hold；若后写 hold 会误发 task_queue_next。
	_ = s.Store.SetAgentTaskQueueHold(ctx, agentID, true)
	if cur, _ := s.Store.GetRunningAgentTask(ctx, agentID); cur != nil {
		if completed, _ := s.Store.CompleteAgentTaskRunning(ctx, cur.ID, store.TaskCancelled, "stopped by user"); completed {
			s.writeBackGitHubIdeaTask(cur.ID, store.TaskCancelled, "stopped by user")
		}
	}
	unlock()
	return s.StopManaged(agentID)
}

// TaskQueueAttsToChat 转 Ask 附件。
func TaskQueueAttsToChat(atts []TaskQueueAttachment) []ChatAttachment {
	out := make([]ChatAttachment, 0, len(atts))
	for _, a := range atts {
		out = append(out, ChatAttachment{ID: a.ID, URL: a.URL, Mime: a.Mime, Name: a.Name})
	}
	return out
}
