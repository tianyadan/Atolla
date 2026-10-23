package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"atolla/server/internal/permission"
	"atolla/server/internal/store"

	"atolla/server/internal/remotebridge"
)

// AskManagedBackground validates the agent then runs AskManagedWith on a detached goroutine (remote-relay).
func (s *Service) AskManagedBackground(ctx context.Context, agentID int64, question string, atts []remotebridge.ChatAtt) error {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil {
		return err
	}
	if a == nil {
		return fmt.Errorf("agent not found")
	}
	if err := GuardAgentUsable(a); err != nil {
		return err
	}
	q := strings.TrimSpace(question)
	chatAtts := chatAttsFromBridge(atts)
	if q == "" && len(chatAtts) == 0 {
		return fmt.Errorf("question required")
	}
	if q == "" {
		q = "请查看图片"
	}
	go func() {
		bg := context.Background()
		_, askErr := s.askManagedUserFacing(bg, agentID, q, chatAtts, store.AgentAskSourceMobile, nil)
		if askErr != nil {
			log.Printf("remotebridge agent.ask agent=%d: %v", agentID, askErr)
		}
		// 回合结束再推一次：此时状态已回到空闲/错误，手机能收起「忙」。
		if s.RemoteBridge != nil {
			s.RemoteBridge.PushAgentMessagesSnapshot(agentID)
		}
	}()
	return nil
}

// PushAgentsMirrorNow 立刻把数字员工列表和状态推到移动端。
// 周期快照是 20 秒一次，且和心跳挤在同一条循环里；不立刻推的话，手机在整个任务期间都只能看到上一次的「空闲」。
func (s *Service) PushAgentsMirrorNow() {
	if s == nil || s.RemoteBridge == nil {
		return
	}
	go s.RemoteBridge.PushAgentsSnapshotNow()
}

// setManagedAgentStatus 写状态；用户正看着该对话时终态不写未读（从源头避免闪烁）。
func (s *Service) setManagedAgentStatus(ctx context.Context, id int64, status, lastErr string, runMs int, convID int64) error {
	if s == nil || s.Store == nil {
		return nil
	}
	markUnread := true
	if status == "idle" || status == "error" {
		markUnread = !s.agentChatOpen(id)
	}
	return s.Store.SetManagedAgentStatusUnread(ctx, id, status, lastErr, runMs, convID, markUnread)
}

// notifyAgentTerminal 任务终态后立刻推镜像；写状态已按 viewer 跳过未读，这里再兜底清一次。
func (s *Service) notifyAgentTerminal(ctx context.Context, agentID int64) {
	if s == nil || agentID <= 0 {
		return
	}
	if s.agentChatOpen(agentID) && s.Store != nil {
		_ = s.Store.ClearManagedAgentTaskUnread(ctx, agentID)
	}
	s.PushAgentsMirrorNow()
}

// SaveChatImageFromBytes implements remotebridge.AgentRuntime for mobile upload RPC.
func (s *Service) SaveChatImageFromBytes(ctx context.Context, raw []byte, filename string) (*remotebridge.ChatAtt, error) {
	att, err := s.SaveChatImage(ctx, raw, filename)
	if err != nil {
		return nil, err
	}
	return &remotebridge.ChatAtt{ID: att.ID, URL: att.URL, Mime: att.Mime, Name: att.Name}, nil
}

func chatAttsFromBridge(atts []remotebridge.ChatAtt) []ChatAttachment {
	if len(atts) == 0 {
		return nil
	}
	out := make([]ChatAttachment, 0, len(atts))
	for _, a := range atts {
		out = append(out, ChatAttachment{ID: a.ID, URL: a.URL, Mime: a.Mime, Name: a.Name})
	}
	return NormalizeChatAttachments(out)
}

// AskManaged 管理台数字员工一轮对话;onEvent 推送 SSE 事件(chunk/invoke_*/…)。可被 StopManaged 取消。
func (s *Service) AskManaged(ctx context.Context, agentID int64, question string, onEvent AskEventSink) (*store.Message, error) {
	return s.AskManagedWith(ctx, agentID, question, nil, onEvent)
}

// AskManagedWith 同 AskManaged，可附带聊天图片（来源记为后台）。
func (s *Service) AskManagedWith(ctx context.Context, agentID int64, question string, atts []ChatAttachment, onEvent AskEventSink) (*store.Message, error) {
	return s.askManagedUserFacing(ctx, agentID, question, atts, store.AgentAskSourceAdmin, onEvent)
}

// askManagedUserFacing 后台或手机发起的主会话 Ask，写入数字员工审计。
func (s *Service) askManagedUserFacing(ctx context.Context, agentID int64, question string, atts []ChatAttachment, source string, onEvent AskEventSink) (*store.Message, error) {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fmt.Errorf("agent not found")
	}
	if err := GuardAgentUsable(a); err != nil {
		return nil, err
	}
	occ, _ := s.Store.GetOccupancy(ctx, agentID)
	if OccupancyBlocksUserChat(occ) {
		return nil, &OccupancyBusyError{Occ: occ}
	}
	_ = s.Store.ClearOccupancy(ctx, agentID)
	if err := s.TryAcquireOccupancy(ctx, store.Occupancy{
		AgentID: agentID, SourceType: SourceDirect, SourceID: fmt.Sprintf("%d", agentID),
		SourceName: a.Name, TaskName: truncate(question, 120),
	}); err != nil {
		return nil, err
	}
	defer s.ReleaseOccupancy(context.WithoutCancel(ctx), agentID)

	msg, askErr := s.askManagedCore(ctx, a, 0, question, askCoreOpts{
		bindMainConv: true,
		attachments:  NormalizeChatAttachments(atts),
		agentAudit:   &agentAskAudit{Source: source},
	}, onEvent)
	if askErr == nil && msg != nil {
		s.notifyTaskDone(agentID, question, fmt.Sprintf("%d-%d", agentID, msg.ID))
	}
	// Push mirror after PC/SSE ask so mobile chat catches up without waiting for next poll.
	if s.RemoteBridge != nil {
		s.RemoteBridge.PushAgentMessagesSnapshot(agentID)
	}
	return msg, askErr
}

// AskManagedIsolated 在指定会话执行(项目协作节点)；不改写数字员工主会话；占用由调用方持有。
func (s *Service) AskManagedIsolated(ctx context.Context, agentID, convID int64, question string, onEvent AskEventSink) (*store.Message, error) {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fmt.Errorf("agent not found")
	}
	if convID <= 0 {
		return nil, fmt.Errorf("conversation required")
	}
	if err := GuardAgentUsable(a); err != nil {
		return nil, err
	}
	return s.askManagedCore(ctx, a, convID, question, askCoreOpts{bindMainConv: false}, onEvent)
}

type askCoreOpts struct {
	bindMainConv bool
	silent       bool
	holdStatus   bool
	skipTaskPlan bool
	attachments  []ChatAttachment
	// visitorAudit 非空时：用户消息落库后建 processing 审计，结束后写 token/耗时/状态。
	visitorAudit *visitorAskAudit
	// agentAudit 非空时：数字员工主会话 Ask 写入审计看板（后台/手机）。
	agentAudit *agentAskAudit
}

// visitorAskAudit 前台一轮 Ask 的审计上下文。
type visitorAskAudit struct {
	VisitorID  int64
	IP         string
	UA         string
	logID      int64
	started    time.Time
	input      int64
	output     int64
	cacheRead  int64
	cacheWrite int64
}

// agentAskAudit 数字员工一轮 Ask 的审计上下文。
type agentAskAudit struct {
	Source     string
	logID      int64
	started    time.Time
	input      int64
	output     int64
	cacheRead  int64
	cacheWrite int64
}

func (s *Service) silentAsk(ctx context.Context, a *store.ManagedAgent, question string, holdStatus bool) (*store.Message, error) {
	msg, err := s.askManagedCore(ctx, a, 0, question, askCoreOpts{
		bindMainConv: true,
		silent:       true,
		holdStatus:   holdStatus,
		skipTaskPlan: true,
	}, nil)
	if err != nil {
		return msg, err
	}
	if msg != nil && msg.Status == "error" {
		errText := strings.TrimSpace(strings.TrimPrefix(msg.Content, "❌ "))
		if errText == "" {
			errText = "silent ask failed"
		}
		return msg, fmt.Errorf("%s", errText)
	}
	return msg, nil
}

func (s *Service) askManagedCore(ctx context.Context, a *store.ManagedAgent, fixedConvID int64, question string, opts askCoreOpts, onEvent AskEventSink) (*store.Message, error) {
	// 先包装 onEvent，再定义 onChunk，确保 usage / 工具事件能写入审计。
	if opts.visitorAudit != nil || opts.agentAudit != nil {
		inner := onEvent
		onEvent = func(ev map[string]any) {
			if ev != nil {
				if t, _ := ev["type"].(string); t == "usage" {
					in := toInt64Any(ev["input_tokens"])
					out := toInt64Any(ev["output_tokens"])
					cr := toInt64Any(ev["cache_read_tokens"])
					cw := toInt64Any(ev["cache_write_tokens"])
					if opts.visitorAudit != nil {
						opts.visitorAudit.input = in
						opts.visitorAudit.output = out
						opts.visitorAudit.cacheRead = cr
						opts.visitorAudit.cacheWrite = cw
					}
					if opts.agentAudit != nil {
						opts.agentAudit.input = in
						opts.agentAudit.output = out
						opts.agentAudit.cacheRead = cr
						opts.agentAudit.cacheWrite = cw
					}
				}
				if opts.agentAudit != nil && opts.agentAudit.logID > 0 {
					s.recordAgentAskToolEvent(opts.agentAudit, a.ID, ev)
				}
			}
			if inner != nil {
				inner(ev)
			}
		}
	}
	agentID := a.ID
	atts := NormalizeChatAttachments(opts.attachments)
	question = strings.TrimSpace(question)
	if question == "" && len(atts) == 0 {
		return nil, fmt.Errorf("empty question")
	}
	if question == "" {
		question = "请查看图片并回答相关问题。"
	}
	userQuestion := question
	// v0.2.18：不再注入平台历史/Memory；上下文靠引擎 resume + 本轮问题。
	engineQuestion := question

	runCtx, cancel := context.WithCancel(ctx)
	slot := &managedRun{cancel: cancel}
	s.runMu.Lock()
	if old, ok := s.runs[agentID]; ok {
		old.cancel()
	}
	s.runs[agentID] = slot
	s.runMu.Unlock()
	defer func() {
		s.runMu.Lock()
		if s.runs[agentID] == slot {
			delete(s.runs, agentID)
		}
		s.runMu.Unlock()
		cancel()
	}()

	convID := fixedConvID
	if convID == 0 {
		var err error
		convID, err = s.ensureLiveAgentConversation(runCtx, a)
		if err != nil {
			return nil, err
		}
	}

	if !opts.holdStatus {
		_ = s.setManagedAgentStatus(runCtx, agentID, "running", "", 0, statusConvID(opts.bindMainConv, convID))
		// 状态已是 running，马上推镜像。等回合结束再推时，状态已经变回 idle，手机全程显示空闲。
		s.PushAgentsMirrorNow()
	}
	liveBuf := s.beginLiveAssistant(convID, agentID)
	defer s.abandonLiveAssistant(convID)
	onChunk := func(chunk string) {
		if liveBuf != nil {
			liveBuf.appendChunk(chunk)
		}
		emitAsk(onEvent, map[string]any{"type": "chunk", "content": chunk})
	}
	if a.AutoReview {
		s.Perms.SetAuto(convID, true)
	}

	all, _ := s.Store.ListManagedAgents(runCtx)
	refs := make([]AgentRef, 0, len(all))
	for _, x := range all {
		if x.ID == agentID {
			continue
		}
		refs = append(refs, AgentRef{ID: x.ID, Name: x.Name})
	}
	mentions, taskBody := ParseMentions(userQuestion, refs)
	if opts.silent {
		mentions = nil
		taskBody = userQuestion
	}
	// 禁止委托自己
	filtered := mentions[:0]
	for _, m := range mentions {
		if m.ID != agentID {
			filtered = append(filtered, m)
		}
	}
	mentions = filtered

	calleeRefs := make([]AgentRef, 0, len(mentions))
	for _, m := range mentions {
		calleeRefs = append(calleeRefs, AgentRef{ID: m.ID, Name: m.Name})
	}

	if !opts.silent {
		// 先落库用户消息，再规划/执行，避免规划耗时或中途压缩清库导致对话框「发出去看不见」
		userMsg := &store.Message{
			ConversationID: convID, Role: "user", Content: userQuestion, Status: "ok",
			MetaJSON: AttachmentsMetaJSON(atts),
		}
		userMsgID, uerr := s.Store.InsertMessage(runCtx, userMsg)
		if uerr != nil {
			log.Printf("ask: insert user message failed: %v", uerr)
			_ = s.setManagedAgentStatus(context.WithoutCancel(runCtx), agentID, "error", uerr.Error(), 0, convID)
			return nil, uerr
		}
		if opts.visitorAudit != nil {
			opts.visitorAudit.started = time.Now()
			logID, aerr := s.Store.BeginVisitorAskLog(runCtx, opts.visitorAudit.VisitorID, convID, agentID, userMsgID, opts.visitorAudit.IP, opts.visitorAudit.UA)
			if aerr != nil {
				log.Printf("visitor ask: begin audit failed: %v", aerr)
			} else {
				opts.visitorAudit.logID = logID
			}
		}
		if opts.agentAudit != nil {
			opts.agentAudit.started = time.Now()
			logID, aerr := s.Store.BeginAgentAskLog(runCtx, agentID, convID, userMsgID, opts.agentAudit.Source)
			if aerr != nil {
				log.Printf("agent ask: begin audit failed: %v", aerr)
			} else {
				opts.agentAudit.logID = logID
			}
		}
	}

	var steps []string
	var tp *TaskProgress
	if shouldEmitTaskPlanAsk(a, opts.skipTaskPlan) {
		// 先规划具体步骤(禁止空话),再进入执行
		steps = s.PlanConcreteSteps(runCtx, a, taskBody, calleeRefs)
		tp = s.beginTaskProgress(runCtx, agentID, truncateRunTitle(taskBody), steps)
		emitAsk(onEvent, map[string]any{"type": "task_progress", "task_id": tp.taskID, "steps": steps, "progress": 0})
	}

	if tp != nil && len(steps) > 0 {
		tp.advance(runCtx, 0, steps[0])
	}

	if len(mentions) > 0 {
		return s.askManagedWithInvokes(runCtx, a, convID, opts, userQuestion, taskBody, mentions, steps, tp, onEvent, onChunk)
	}

	sys := s.BuildAgentSystemPromptWithSkills(runCtx, a)
	sys = s.consumeSystemReinject(runCtx, convID, sys)
	userTurns, _ := s.Store.CountUserMessages(runCtx, convID)
	q := MaybeReinforcePolicy(a, userTurns, engineQuestion)
	mid := 1
	if len(steps) > 2 {
		mid = len(steps) / 2
	}
	if tp != nil && mid < len(steps) {
		tp.advance(runCtx, mid, steps[mid])
	}

	// history 有 session 时恒空；丢失时由 runManagedEngine 回退 RecentTurns
	out, ms, runErr := s.runEngineWithRecover(runCtx, a, convID, convID, sys, q, "", onChunk, onEvent, userQuestion, atts)
	msg, err := s.finishManagedAsk(runCtx, agentID, convID, opts.bindMainConv, out, ms, runErr, tp, opts)
	s.flushCompactAfterAsk(runCtx, convID, onEvent)
	s.finalizeVisitorAskAudit(runCtx, opts.visitorAudit, msg, runErr)
	s.finalizeAgentAskAudit(runCtx, opts.agentAudit, msg, runErr)
	return msg, err
}

// ensureLiveAgentConversation 返回仍存在的主会话。指针指向已删除会话时新建并重新绑定。
func (s *Service) ensureLiveAgentConversation(ctx context.Context, a *store.ManagedAgent) (int64, error) {
	if a.ConversationID > 0 {
		alive, err := s.Store.ConversationAlive(ctx, a.ConversationID)
		if err != nil {
			return 0, err
		}
		if alive {
			return a.ConversationID, nil
		}
		log.Printf("agent %d conversation %d is missing, opening a new chat", a.ID, a.ConversationID)
	}
	convID, err := s.Store.CreateAgentConversation(ctx, a.ID)
	if err != nil {
		return 0, err
	}
	if err := s.Store.SetManagedAgentConversation(ctx, a.ID, convID); err != nil {
		return 0, err
	}
	a.ConversationID = convID
	return convID, nil
}

func statusConvID(bind bool, convID int64) int64 {
	if bind {
		return convID
	}
	return 0
}

func (s *Service) askManagedWithInvokes(
	ctx context.Context,
	caller *store.ManagedAgent,
	convID int64,
	opts askCoreOpts,
	rawQuestion, taskBody string,
	mentions []Mention,
	steps []string,
	tp *TaskProgress,
	onEvent AskEventSink,
	onChunk func(string),
) (*store.Message, error) {
	bindMainConv := opts.bindMainConv
	// 步骤 0 已是理解需求；从 1 开始委托
	results := s.invokeAllParallel(ctx, caller, mentions, taskBody, onEvent)
	for i, r := range results {
		stepIdx := i + 1
		if tp != nil && stepIdx < len(steps) {
			tp.advance(ctx, stepIdx, steps[stepIdx])
		}
		meta, _ := json.Marshal(map[string]any{
			"callee_id": r.AgentID, "callee_name": r.AgentName, "engine": r.Engine, "error": r.Err,
		})
		quote := formatInvokeQuote(r)
		_, _ = s.Store.InsertMessage(ctx, &store.Message{
			ConversationID: convID,
			Role:           "invoke_quote",
			Content:        quote,
			Status:         "ok",
			MetaJSON:       string(meta),
		})
		emitAsk(onEvent, map[string]any{
			"type": "invoke_quote", "callee_id": r.AgentID, "callee_name": r.AgentName,
			"content": quote, "collapsed": true,
		})
	}

	if tp != nil && len(steps) > 0 {
		sumStep := len(steps) - 1
		if sumStep < 0 {
			sumStep = 0
		}
		tp.advance(ctx, sumStep, steps[sumStep])
	}
	// 委托并行跑完后从库重载调用方，避免长生命周期结构体上的引擎路径被脏内存改成 "\x00gent"。
	if fresh, err := s.Store.GetManagedAgent(ctx, caller.ID); err == nil && fresh != nil {
		caller = fresh
	}
	sys := s.BuildAgentSystemPromptWithSkills(ctx, caller) + "\n你是协作编排方：根据各同事的隔离结果分别汇总，并标明归属。"
	sys = s.consumeSystemReinject(ctx, convID, sys)
	sumQ := buildSummaryQuestion(taskBody, results)
	userTurns, _ := s.Store.CountUserMessages(ctx, convID)
	sumQ = MaybeReinforcePolicy(caller, userTurns, sumQ)

	out, ms, runErr := s.runEngineWithRecover(ctx, caller, convID, convID, sys, sumQ, "", onChunk, onEvent, taskBody, nil)
	msg, err := s.finishManagedAsk(ctx, caller.ID, convID, bindMainConv, out, ms, runErr, tp, opts)
	s.flushCompactAfterAsk(ctx, convID, onEvent)
	s.finalizeVisitorAskAudit(ctx, opts.visitorAudit, msg, runErr)
	s.finalizeAgentAskAudit(ctx, opts.agentAudit, msg, runErr)
	s.writeInvokeDividersAsync(caller, taskBody, results)
	return msg, err
}

// flushCompactAfterAsk 引擎回合内发生压缩时，在 assistant 落库后再同步平台历史。
func (s *Service) flushCompactAfterAsk(ctx context.Context, convID int64, onEvent AskEventSink) {
	if !s.consumeCompactPending(convID) {
		return
	}
	_ = s.SyncPlatformAfterCompact(context.WithoutCancel(ctx), convID)
	emitAsk(onEvent, map[string]any{
		"type": "context_compacted", "content": CompactNoticeText,
		"used_tokens": 0, "estimated": true, // compact 后重置估算占用
	})
}

func (s *Service) finishManagedAsk(ctx context.Context, agentID, convID int64, bindMainConv bool, out string, ms int, runErr error, tp *TaskProgress, opts askCoreOpts) (*store.Message, error) {
	out, runErr = applyCancelledAskOutput(ctx.Err(), out, runErr)
	if ctx.Err() != nil && ms == 0 {
		ms = 1
	}
	status := "ok"
	lastErr := ""
	agentStatus := "idle"
	if runErr != nil {
		status = "error"
		lastErr = runErr.Error()
		agentStatus = "error"
		if out == "" {
			out = "❌ " + lastErr
		}
		if tp != nil {
			tp.fail(context.WithoutCancel(ctx), lastErr)
		}
	} else if tp != nil {
		tp.done(context.WithoutCancel(ctx), "已完成")
	}

	// 若中途已按「思考→命令」切段落库，收尾只写入尚未落库的尾巴，避免整段 out 再插一条破坏时间线。
	tail, hadFlush := s.endLiveAssistant(convID)
	persist := out
	if hadFlush {
		persist = tail
		if strings.TrimSpace(persist) == "" && runErr != nil {
			persist = out
		}
	}

	msg := &store.Message{
		ConversationID: convID, Role: "assistant", Content: out, Status: status, ReplyMs: ms,
	}
	if !opts.silent && strings.TrimSpace(persist) != "" {
		row := &store.Message{
			ConversationID: convID, Role: "assistant", Content: persist, Status: status, ReplyMs: ms,
		}
		if id, err := s.Store.InsertMessage(context.WithoutCancel(ctx), row); err != nil {
			log.Printf("finishManagedAsk: insert assistant failed: %v", err)
		} else {
			msg.ID = id
			msg.Content = persist
		}
	}
	if !opts.holdStatus {
		_ = s.setManagedAgentStatus(context.WithoutCancel(ctx), agentID, agentStatus, lastErr, ms, statusConvID(bindMainConv, convID))
		s.notifyAgentTerminal(context.WithoutCancel(ctx), agentID)
	}
	return msg, nil
}

// finalizeVisitorAskAudit 写完 assistant 后结束审计；失败只打日志，不拖垮主链路。
func (s *Service) finalizeVisitorAskAudit(ctx context.Context, audit *visitorAskAudit, msg *store.Message, runErr error) {
	if audit == nil || audit.logID <= 0 {
		return
	}
	status := store.AskStatusSuccess
	errMsg := ""
	if ctx.Err() != nil {
		status = store.AskStatusCancelled
		errMsg = ctx.Err().Error()
	} else if runErr != nil {
		status = store.AskStatusError
		errMsg = runErr.Error()
	}
	asstID := int64(0)
	duration := int(time.Since(audit.started).Milliseconds())
	if msg != nil {
		asstID = msg.ID
		if msg.Status == "error" && status == store.AskStatusSuccess {
			status = store.AskStatusError
		}
	}
	if duration <= 0 {
		duration = 1
	}
	cached := audit.cacheRead + audit.cacheWrite
	total := audit.input + audit.output + cached
	if err := s.Store.FinishVisitorAskLog(context.WithoutCancel(ctx), audit.logID, asstID,
		audit.input, audit.output, cached, total, duration, status, errMsg); err != nil {
		log.Printf("visitor ask: finish audit %d failed: %v", audit.logID, err)
	}
}

// recordAgentAskToolEvent 从 SSE 活动/命令事件落工具审计（拿不到耗时时记 0）。
func (s *Service) recordAgentAskToolEvent(audit *agentAskAudit, agentID int64, ev map[string]any) {
	if audit == nil || audit.logID <= 0 || ev == nil {
		return
	}
	typ, _ := ev["type"].(string)
	var tool string
	result := store.AgentAskToolOK
	switch typ {
	case "activity":
		tool, _ = ev["tool"].(string)
		if tool == "" {
			tool, _ = ev["tool_name"].(string)
		}
	case "command":
		tool, _ = ev["tool_name"].(string)
		if tool == "" {
			tool, _ = ev["tool"].(string)
		}
		if d, _ := ev["denied"].(bool); d {
			result = store.AgentAskToolDenied
		}
	default:
		return
	}
	tool = strings.TrimSpace(tool)
	if tool == "" {
		return
	}
	if err := s.Store.InsertAgentAskToolCall(context.Background(), audit.logID, agentID, tool, result, 0); err != nil {
		log.Printf("agent ask: tool audit failed: %v", err)
	}
}

// mapAgentAskStatus 把取消/超时/失败映射到审计终态。
func mapAgentAskStatus(ctxErr, runErr error, msg *store.Message) (status, errType, errMsg string) {
	if ctxErr != nil {
		return store.AgentAskStatusCancelled, "cancelled", ctxErr.Error()
	}
	if runErr != nil {
		errMsg = runErr.Error()
		low := strings.ToLower(errMsg)
		if strings.Contains(low, "timeout") || strings.Contains(low, "deadline") || strings.Contains(errMsg, "超时") {
			return store.AgentAskStatusTimeout, "timeout", errMsg
		}
		if strings.Contains(low, "interrupt") || strings.Contains(errMsg, "中断") {
			return store.AgentAskStatusInterrupted, "interrupted", errMsg
		}
		return store.AgentAskStatusFailed, "error", errMsg
	}
	if msg != nil && msg.Status == "error" {
		errMsg = strings.TrimSpace(strings.TrimPrefix(msg.Content, "❌ "))
		return store.AgentAskStatusFailed, "error", errMsg
	}
	return store.AgentAskStatusCompleted, "", ""
}

// finalizeAgentAskAudit 结束数字员工审计；失败只打日志。
func (s *Service) finalizeAgentAskAudit(ctx context.Context, audit *agentAskAudit, msg *store.Message, runErr error) {
	if audit == nil || audit.logID <= 0 {
		return
	}
	status, errType, errMsg := mapAgentAskStatus(ctx.Err(), runErr, msg)
	duration := int(time.Since(audit.started).Milliseconds())
	if duration <= 0 {
		duration = 1
	}
	cached := audit.cacheRead + audit.cacheWrite
	total := audit.input + audit.output + cached
	if err := s.Store.FinishAgentAskLog(context.WithoutCancel(ctx), audit.logID,
		audit.input, audit.output, total, duration, status, errType, errMsg); err != nil {
		log.Printf("agent ask: finish audit %d failed: %v", audit.logID, err)
	}
}

func toInt64Any(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case int:
		return int64(t)
	case float64:
		return int64(t)
	case json.Number:
		i, _ := t.Int64()
		return i
	default:
		return 0
	}
}

// applyCancelledAskOutput 请求被取消时保留已生成正文，避免刷新页面把回复覆盖成只有「已终止」。
// 「No response requested.」是 CLI 本地命令空转，不当成有效回复。
func applyCancelledAskOutput(ctxErr error, out string, runErr error) (string, error) {
	if ctxErr == nil {
		return out, runErr
	}
	trimmed := strings.TrimSpace(out)
	if trimmed == "" || trimmed == "No response requested." {
		return "⏹ 已终止本次对话", nil
	}
	if !strings.Contains(trimmed, "已终止本次对话") {
		trimmed += "\n\n⏹ 已终止本次对话"
	}
	return trimmed, nil
}

// StopManaged 终止该数字员工当前进行中的 Ask。
func (s *Service) StopManaged(agentID int64) bool {
	s.runMu.Lock()
	slot, ok := s.runs[agentID]
	if ok {
		delete(s.runs, agentID)
	}
	s.runMu.Unlock()
	if !ok || slot == nil {
		return false
	}
	slot.cancel()
	a, _ := s.Store.GetManagedAgent(context.Background(), agentID)
	convID := int64(0)
	if a != nil {
		convID = a.ConversationID
	}
	_ = s.setManagedAgentStatus(context.Background(), agentID, "idle", "stopped by user", 0, convID)
	s.notifyAgentTerminal(context.Background(), agentID)
	s.ReleaseOccupancy(context.Background(), agentID)
	return true
}

// SetAutoReview persists AI auto-review and updates the live Hub for the agent conversation.
func (s *Service) SetAutoReview(ctx context.Context, agentID int64, enabled bool) error {
	if enabled {
		if err := s.RequireJevosEnabled(); err != nil {
			return err
		}
	}
	if err := s.Store.SetManagedAgentAutoReview(ctx, agentID, enabled); err != nil {
		return err
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return err
	}
	if a.ConversationID > 0 && s.Perms != nil {
		s.Perms.SetAuto(a.ConversationID, enabled)
	}
	return nil
}

// SetAutoApproveAll persists「命令全部审批通过」.
func (s *Service) SetAutoApproveAll(ctx context.Context, agentID int64, enabled bool) error {
	return s.Store.SetManagedAgentAutoApproveAll(ctx, agentID, enabled)
}

// DecidePermission resolves a pending Hub request for remote-relay phone clients.
func (s *Service) DecidePermission(requestID, behavior string) error {
	if s.Perms == nil {
		return fmt.Errorf("permission hub not configured")
	}
	b := permission.Deny
	session := false
	if strings.EqualFold(behavior, "allow") || strings.EqualFold(behavior, "allow_session") {
		b = permission.Allow
	}
	if strings.EqualFold(behavior, "allow_session") {
		session = true
	}
	return s.Perms.Decide(requestID, b, "user", session)
}

// ClearManagedChat 清空当前会话消息，并解除引擎 session 绑定（避免 Codex resume 到已失效 thread）。
func (s *Service) ClearManagedChat(ctx context.Context, agentID int64) error {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		if a == nil && err == nil {
			return fmt.Errorf("agent not found")
		}
		return err
	}
	if a.ConversationID == 0 {
		return nil
	}
	if err := s.Store.ClearConversationMessages(ctx, a.ConversationID); err != nil {
		return err
	}
	return s.Store.ClearConversationEngineMeta(ctx, a.ConversationID)
}
