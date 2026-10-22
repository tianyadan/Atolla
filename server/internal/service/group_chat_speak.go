package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"atolla/server/internal/store"
)

var (
	// ErrGroupChatNotMember 发言人不是该群成员。
	ErrGroupChatNotMember = errors.New("speaker is not a group member")
	// ErrGroupChatBusy 群正在开会（串行占用）。
	ErrGroupChatBusy = errors.New("group meeting already running")
)

const groupChatRules = `【群聊规则】
你正在 Atolla 群聊共享时间线中发言。
- 只代表你自己发言，面向全员可读；不要假装其他同事。
- 简洁、可执行；需要点名时用 @[姓名](#agent:ID) 格式。
- 命令审批仍走现有权限流程；不要编造已执行结果。`

// SpeakInGroup 群内发言：气泡写入群 shared conversation；引擎 resume 用发言人主会话。
func (s *Service) SpeakInGroup(ctx context.Context, groupID, speakerAgentID int64, prompt string, onEvent AskEventSink) (*store.Message, error) {
	prompt = strings.TrimSpace(prompt)
	if groupID <= 0 || speakerAgentID <= 0 || prompt == "" {
		return nil, store.ErrInvalidGroupChatInput
	}

	detail, err := s.Store.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		return nil, err
	}
	var member *store.GroupChatMember
	for i := range detail.Members {
		if detail.Members[i].AgentID == speakerAgentID {
			member = &detail.Members[i]
			break
		}
	}
	if member == nil {
		return nil, ErrGroupChatNotMember
	}

	a, err := s.Store.GetManagedAgent(ctx, speakerAgentID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, ErrGroupChatAgentNotFound
	}
	if err := GuardAgentUsable(a); err != nil {
		return nil, err
	}

	occ, _ := s.Store.GetOccupancy(ctx, speakerAgentID)
	if OccupancyBlocksUserChat(occ) {
		return nil, &OccupancyBusyError{Occ: occ}
	}
	_ = s.Store.ClearOccupancy(ctx, speakerAgentID)
	if err := s.TryAcquireOccupancy(ctx, store.Occupancy{
		AgentID: speakerAgentID, SourceType: SourceDirect, SourceID: fmt.Sprintf("group:%d", groupID),
		SourceName: detail.Name, TaskName: truncate("群聊发言: "+prompt, 120),
	}); err != nil {
		return nil, err
	}
	defer s.ReleaseOccupancy(context.WithoutCancel(ctx), speakerAgentID)

	groupConv := detail.SharedConversationID
	if groupConv <= 0 {
		return nil, fmt.Errorf("group shared conversation missing")
	}
	sessionConv := a.ConversationID
	if sessionConv <= 0 {
		sessionConv, err = s.ensureLiveAgentConversation(ctx, a)
		if err != nil {
			return nil, err
		}
	}

	runCtx, cancel := context.WithCancel(ctx)
	slot := &managedRun{cancel: cancel}
	s.runMu.Lock()
	if old, ok := s.runs[speakerAgentID]; ok {
		old.cancel()
	}
	s.runs[speakerAgentID] = slot
	s.runMu.Unlock()
	defer func() {
		s.runMu.Lock()
		if s.runs[speakerAgentID] == slot {
			delete(s.runs, speakerAgentID)
		}
		s.runMu.Unlock()
		cancel()
	}()

	_ = s.Store.SetManagedAgentStatus(runCtx, speakerAgentID, "running", "", 0, 0)
	s.PushAgentsMirrorNow()

	emitAsk(onEvent, map[string]any{
		"type":             "speaker",
		"speaker_agent_id": a.ID,
		"speaker_name":     a.Name,
		"group_id":         groupID,
	})

	sys := s.buildGroupSpeakSystem(runCtx, detail, a, member.GroupTag)
	onChunk := func(chunk string) {
		emitAsk(onEvent, map[string]any{
			"type":             "chunk",
			"content":          chunk,
			"speaker_agent_id": a.ID,
			"speaker_name":     a.Name,
		})
	}

	out, ms, runErr := s.runEngineWithRecover(runCtx, a, sessionConv, groupConv, sys, prompt, "", onChunk, onEvent, prompt, nil)
	out, runErr = applyCancelledAskOutput(runCtx.Err(), out, runErr)

	status := "ok"
	agentStatus := "idle"
	lastErr := ""
	if runErr != nil {
		status = "error"
		agentStatus = "error"
		lastErr = runErr.Error()
		if strings.TrimSpace(out) == "" {
			out = "❌ " + lastErr
		}
	}

	meta, _ := json.Marshal(map[string]any{
		"speaker_agent_id": a.ID,
		"speaker_name":     a.Name,
		"group_id":         groupID,
	})
	msg := &store.Message{
		ConversationID: groupConv,
		Role:           "assistant",
		Content:        out,
		Status:         status,
		ReplyMs:        ms,
		MetaJSON:       string(meta),
	}
	if strings.TrimSpace(out) != "" {
		id, ierr := s.Store.InsertMessage(context.WithoutCancel(runCtx), msg)
		if ierr != nil {
			log.Printf("SpeakInGroup: insert assistant failed: %v", ierr)
		} else {
			msg.ID = id
		}
	}
	_ = s.Store.SetManagedAgentStatus(context.WithoutCancel(runCtx), speakerAgentID, agentStatus, lastErr, ms, 0)

	emitAsk(onEvent, map[string]any{
		"type":             "done",
		"speaker_agent_id": a.ID,
		"speaker_name":     a.Name,
		"message_id":       msg.ID,
		"status":           status,
	})
	if runErr != nil {
		return msg, runErr
	}
	return msg, nil
}

// buildGroupSpeakSystem 群规则 + 共享背景 +（标签 | 原 prompt/skills）+ 本轮由 prompt 承载。
func (s *Service) buildGroupSpeakSystem(ctx context.Context, detail *store.GroupChatWithMembers, a *store.ManagedAgent, groupTag string) string {
	persona := ""
	tag := strings.TrimSpace(groupTag)
	if tag != "" {
		persona = buildGroupTagPersona(a.Name, tag)
	} else {
		persona = s.BuildAgentSystemPromptWithSkills(ctx, a)
	}
	return composeGroupSpeakSystem(detail.Name, detail.SharedBackground, persona)
}

// composeGroupSpeakSystem 纯函数：便于单测「有 tag 时不含技能夹具」。
func composeGroupSpeakSystem(groupName, sharedBackground, personaBlock string) string {
	var b strings.Builder
	b.WriteString(groupChatRules)
	b.WriteString("\n\n【群名】")
	b.WriteString(strings.TrimSpace(groupName))
	bg := strings.TrimSpace(sharedBackground)
	if bg != "" {
		b.WriteString("\n\n【共享会议背景（仅群主主会话摘录）】\n")
		b.WriteString(bg)
	}
	personaBlock = strings.TrimSpace(personaBlock)
	if personaBlock != "" {
		b.WriteString("\n\n【你的本群人设】\n")
		b.WriteString(personaBlock)
	}
	return b.String()
}

// buildGroupTagPersona 有群内标签时忽略原 prompt/skills。
func buildGroupTagPersona(name, tag string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "同事"
	}
	return fmt.Sprintf("你是「%s」。本群标签（覆盖原系统提示词与技能）：\n%s", name, strings.TrimSpace(tag))
}

// groupMeetingSpeakFn 可注入的发言函数（单测 mock 顺序）。
type groupMeetingSpeakFn func(ctx context.Context, groupID, speakerAgentID int64, prompt string, onEvent AskEventSink) (*store.Message, error)

// RunGroupMeeting 首轮主持流水线：群主开场 → 成员串行 → 群主收尾。禁止 invokeAllParallel。
func (s *Service) RunGroupMeeting(ctx context.Context, groupID int64, onEvent AskEventSink) error {
	return s.runGroupMeeting(ctx, groupID, onEvent, s.SpeakInGroup)
}

func (s *Service) runGroupMeeting(ctx context.Context, groupID int64, onEvent AskEventSink, speak groupMeetingSpeakFn) error {
	if groupID <= 0 {
		return store.ErrInvalidGroupChatInput
	}
	if speak == nil {
		speak = s.SpeakInGroup
	}
	detail, err := s.Store.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		return err
	}
	ownerID := detail.OwnerAgentID
	seed := strings.TrimSpace(detail.SeedQuestion)
	if seed == "" {
		seed = "请主持本场群聊讨论。"
	}

	members := make([]store.GroupChatMember, 0, len(detail.Members))
	memberNames := make(map[int64]string)
	for _, m := range detail.Members {
		members = append(members, m)
		if a, e := s.Store.GetManagedAgent(ctx, m.AgentID); e == nil && a != nil {
			memberNames[m.AgentID] = a.Name
		}
	}

	emitAsk(onEvent, map[string]any{"type": "meeting_start", "group_id": groupID})

	openPrompt := buildOwnerOpenPrompt(seed, members, memberNames, ownerID)
	ownerMsg, err := speak(ctx, groupID, ownerID, openPrompt, onEvent)
	if err != nil {
		emitAsk(onEvent, map[string]any{"type": "error", "error": err.Error(), "phase": "owner_open"})
		return err
	}

	order := parseSpeakOrderFromText(ownerMsg.Content, members, ownerID)
	if len(order) == 0 {
		order = defaultSpeakOrder(members, ownerID)
	}

	for _, mid := range order {
		name := memberNames[mid]
		if name == "" {
			name = fmt.Sprintf("#%d", mid)
		}
		p := buildMemberSpeakPrompt(seed, name, ownerMsg.Content)
		if _, err := speak(ctx, groupID, mid, p, onEvent); err != nil {
			emitAsk(onEvent, map[string]any{
				"type": "error", "error": err.Error(), "phase": "member", "speaker_agent_id": mid,
			})
			// 单个成员失败不中断整场；继续下一位
			continue
		}
	}

	closePrompt := buildOwnerClosePrompt(seed)
	if _, err := speak(ctx, groupID, ownerID, closePrompt, onEvent); err != nil {
		emitAsk(onEvent, map[string]any{"type": "error", "error": err.Error(), "phase": "owner_close"})
		return err
	}

	emitAsk(onEvent, map[string]any{"type": "meeting_done", "group_id": groupID})
	return nil
}

func buildOwnerOpenPrompt(seed string, members []store.GroupChatMember, names map[int64]string, ownerID int64) string {
	var b strings.Builder
	b.WriteString("用户开场问题：\n")
	b.WriteString(seed)
	b.WriteString("\n\n你是本场群主。请：\n")
	b.WriteString("1) 简要拆解任务；\n")
	b.WriteString("2) 点名发言顺序（必须用 @[姓名](#agent:ID) 点名其他成员，每人最多一句任务）；\n")
	b.WriteString("3) 先不要替别人回答。\n\n可点名成员：\n")
	for _, m := range members {
		if m.AgentID == ownerID {
			continue
		}
		n := names[m.AgentID]
		if n == "" {
			n = fmt.Sprintf("同事%d", m.AgentID)
		}
		fmt.Fprintf(&b, "- @[%s](#agent:%d)\n", n, m.AgentID)
	}
	return b.String()
}

func buildMemberSpeakPrompt(seed, memberName, ownerOpen string) string {
	var b strings.Builder
	b.WriteString("用户开场问题：\n")
	b.WriteString(seed)
	b.WriteString("\n\n群主刚才的主持与点名：\n")
	b.WriteString(truncate(ownerOpen, 4000))
	b.WriteString("\n\n现在轮到你（")
	b.WriteString(memberName)
	b.WriteString("）发言：只回答与你相关的部分，简洁给出结论或下一步。")
	return b.String()
}

func buildOwnerClosePrompt(seed string) string {
	return "用户开场问题：\n" + seed + "\n\n请根据刚才各位的发言做简短收尾汇总，并给出明确下一步（若有分歧请点明）。"
}

// parseSpeakOrderFromText 从群主开场回复解析点名顺序；忽略群主自己。
func parseSpeakOrderFromText(text string, members []store.GroupChatMember, ownerID int64) []int64 {
	allowed := map[int64]struct{}{}
	for _, m := range members {
		if m.AgentID != ownerID {
			allowed[m.AgentID] = struct{}{}
		}
	}
	ids := parseMentionAgentIDsFromText(text)
	var out []int64
	seen := map[int64]struct{}{}
	for _, id := range ids {
		if _, ok := allowed[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func parseMentionAgentIDsFromText(text string) []int64 {
	var out []int64
	seen := map[int64]struct{}{}
	// mentionTokenRe: @[Name](#agent:ID) → groups name, id
	for _, m := range mentionTokenRe.FindAllStringSubmatch(text, -1) {
		if len(m) < 3 {
			continue
		}
		var id int64
		fmt.Sscanf(m[2], "%d", &id)
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func defaultSpeakOrder(members []store.GroupChatMember, ownerID int64) []int64 {
	var out []int64
	for _, m := range members {
		if m.AgentID != ownerID {
			out = append(out, m.AgentID)
		}
	}
	return out
}
