package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"atolla/server/internal/store"
)

const taskQueueResumePrefix = "（系统）上一轮执行被紧急任务打断，请根据最新对话完整重新完成本任务，避免重复已完成的副作用。\n\n"

var (
	ErrTaskQueueFull      = errors.New("任务队列已满（最多 20 条活跃）")
	ErrTaskQueuePauseFull = errors.New("打断次数过多，请先处理紧急任务或终止")
	ErrTaskQueueLocked    = errors.New("数字人正被项目协作占用，请稍后再打断")
	errTaskQueueEmptyQ    = errors.New("question required")
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
	if s.tqLocks == nil {
		s.tqLocks = &taskQueueLocks{}
	}
	return s.tqLocks.lock(agentID)
}

// TaskQueueAttachment 入队附件（已上传）。
type TaskQueueAttachment struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Mime string `json:"mime"`
	Name string `json:"name"`
}

// TaskQueueView 列表 API 视图。
type TaskQueueView struct {
	Items []store.AgentTaskQueueItem `json:"items"`
	Hold  bool                       `json:"hold"`
	Active int                       `json:"active"`
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
	return TaskQueueView{Items: items, Hold: hold, Active: active}, nil
}

// EnqueueAgentTask 追加到队列末尾（不停当前）。
func (s *Service) EnqueueAgentTask(ctx context.Context, agentID int64, question string, atts []TaskQueueAttachment) (*store.AgentTaskQueueItem, error) {
	question = strings.TrimSpace(question)
	if question == "" && len(atts) == 0 {
		return nil, errTaskQueueEmptyQ
	}
	unlock := s.taskQueueLock(agentID)
	defer unlock()

	active, err := s.Store.CountAgentTaskActive(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if active >= store.TaskQueueMaxActive {
		return nil, ErrTaskQueueFull
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return nil, fmt.Errorf("agent not found")
	}
	pos, err := s.Store.NextAgentTaskPosition(ctx, agentID)
	if err != nil {
		return nil, err
	}
	attJSON, err := marshalTaskAtts(atts)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	return s.Store.GetAgentTaskQueueItem(ctx, id)
}

// InterruptPreferAgentTask 打断当前 → paused，登记紧急任务为 running，由调用方发起 Ask。
func (s *Service) InterruptPreferAgentTask(ctx context.Context, agentID int64, question string, atts []TaskQueueAttachment) (*store.AgentTaskQueueItem, error) {
	question = strings.TrimSpace(question)
	if question == "" && len(atts) == 0 {
		return nil, errTaskQueueEmptyQ
	}
	unlock := s.taskQueueLock(agentID)
	defer unlock()

	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return nil, fmt.Errorf("agent not found")
	}
	occ, _ := s.Store.GetOccupancy(ctx, agentID)
	if OccupancyBlocksUserChat(occ) {
		return nil, ErrTaskQueueLocked
	}
	pausedN, err := s.Store.CountAgentTaskPaused(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if pausedN >= store.TaskQueueMaxPaused {
		return nil, ErrTaskQueuePauseFull
	}
	active, err := s.Store.CountAgentTaskActive(ctx, agentID)
	if err != nil {
		return nil, err
	}
	// 打断会多一条紧急 running；若已满且当前无 running 可替换则拒
	running, err := s.Store.GetRunningAgentTask(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if running == nil && active >= store.TaskQueueMaxActive {
		return nil, ErrTaskQueueFull
	}
	if running != nil {
		rank, err := s.Store.NextAgentTaskPauseRank(ctx, agentID)
		if err != nil {
			return nil, err
		}
		if ok, err := s.Store.PauseAgentTaskRunning(ctx, running.ID, rank); err != nil {
			return nil, err
		} else if !ok {
			// 竞态：无 running 了
			running = nil
		}
	}
	// 停引擎；不走 StopManaged 的 cancelled+hold（打断要自动续）
	s.stopManagedForInterrupt(agentID)
	_ = s.Store.SetAgentTaskQueueHold(ctx, agentID, false)

	attJSON, err := marshalTaskAtts(atts)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	id, err := s.Store.InsertAgentTaskQueue(ctx, store.AgentTaskQueueItem{
		AgentID:         agentID,
		ConversationID:  a.ConversationID,
		Status:          store.TaskRunning,
		Question:        question,
		AttachmentsJSON: attJSON,
		Position:        0,
		StartedAt:       &now,
		SilentNotify:    false,
	})
	if err != nil {
		return nil, err
	}
	return s.Store.GetAgentTaskQueueItem(ctx, id)
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

// CancelAgentTaskQueueItem 取消 queued/paused。
func (s *Service) CancelAgentTaskQueueItem(ctx context.Context, agentID, taskID int64) error {
	unlock := s.taskQueueLock(agentID)
	defer unlock()
	ok, err := s.Store.CancelAgentTask(ctx, agentID, taskID)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("task not cancellable")
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

// StopManagedAndHoldQueue 用户点终止：取消当前 running 队列项并 hold。
func (s *Service) StopManagedAndHoldQueue(agentID int64) bool {
	stopped := s.StopManaged(agentID)
	ctx := context.Background()
	unlock := s.taskQueueLock(agentID)
	defer unlock()
	if cur, _ := s.Store.GetRunningAgentTask(ctx, agentID); cur != nil {
		_, _ = s.Store.CompleteAgentTaskRunning(ctx, cur.ID, store.TaskCancelled, "stopped by user")
	}
	_ = s.Store.SetAgentTaskQueueHold(ctx, agentID, true)
	return stopped
}

// TaskQueueAttsToChat 转 Ask 附件。
func TaskQueueAttsToChat(atts []TaskQueueAttachment) []ChatAttachment {
	out := make([]ChatAttachment, 0, len(atts))
	for _, a := range atts {
		out = append(out, ChatAttachment{ID: a.ID, URL: a.URL, Mime: a.Mime, Name: a.Name})
	}
	return out
}
