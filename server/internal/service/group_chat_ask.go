package service

import (
	"context"
	"fmt"
	"strings"

	"atolla/server/internal/store"
)

// AskInGroup 用户在群内续聊：先落用户消息；无 @ 则群主答；有 @ 则仅被 @ 成员串行发言。
func (s *Service) AskInGroup(ctx context.Context, groupID int64, question string, onEvent AskEventSink) error {
	question = strings.TrimSpace(question)
	if groupID <= 0 || question == "" {
		return store.ErrInvalidGroupChatInput
	}

	detail, err := s.Store.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		return err
	}
	groupConv := detail.SharedConversationID
	if groupConv <= 0 {
		return fmt.Errorf("group shared conversation missing")
	}

	userMsg := &store.Message{
		ConversationID: groupConv,
		Role:           "user",
		Content:        question,
		Status:         "ok",
	}
	if _, err := s.Store.InsertMessage(ctx, userMsg); err != nil {
		return err
	}
	emitAsk(onEvent, map[string]any{
		"type":    "user_message",
		"content": question,
		"group_id": groupID,
	})

	memberNames := map[int64]string{}
	for _, m := range detail.Members {
		if a, e := s.Store.GetManagedAgent(ctx, m.AgentID); e == nil && a != nil {
			memberNames[m.AgentID] = a.Name
		}
	}

	speakers := resolveGroupAskSpeakers(question, detail.Members, detail.OwnerAgentID)

	if len(speakers) == 0 {
		// MVP：无 @ → 群主直接回应
		prompt := "用户在群里说：\n" + question + "\n\n请以群主身份简短回应，可点名其他成员但本轮只你发言。"
		if _, err := s.SpeakInGroup(ctx, groupID, detail.OwnerAgentID, prompt, onEvent); err != nil {
			emitAsk(onEvent, map[string]any{"type": "error", "error": err.Error(), "phase": "owner_reply"})
			return err
		}
		emitAsk(onEvent, map[string]any{"type": "ask_done", "group_id": groupID})
		return nil
	}

	for _, sid := range speakers {
		name := memberNames[sid]
		if name == "" {
			name = fmt.Sprintf("#%d", sid)
		}
		prompt := buildGroupAskMemberPrompt(question, name)
		if _, err := s.SpeakInGroup(ctx, groupID, sid, prompt, onEvent); err != nil {
			emitAsk(onEvent, map[string]any{
				"type": "error", "error": err.Error(), "phase": "member_reply", "speaker_agent_id": sid,
			})
			continue
		}
	}
	emitAsk(onEvent, map[string]any{"type": "ask_done", "group_id": groupID})
	return nil
}

func buildGroupAskMemberPrompt(question, memberName string) string {
	return "用户在群里说：\n" + question + "\n\n你（" + memberName + "）被点名了：请只回答与你相关的部分，简洁给出结论。"
}

// resolveGroupAskSpeakers 解析群内 @；非成员忽略。空切片表示应由群主答。
func resolveGroupAskSpeakers(question string, members []store.GroupChatMember, ownerID int64) []int64 {
	_ = ownerID
	memberSet := map[int64]struct{}{}
	for _, m := range members {
		memberSet[m.AgentID] = struct{}{}
	}
	mentioned := parseMentionAgentIDsFromText(question)
	var speakers []int64
	seen := map[int64]struct{}{}
	for _, id := range mentioned {
		if _, ok := memberSet[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		speakers = append(speakers, id)
	}
	return speakers
}

// TransferGroupOwner 转让群主（须已是成员）。
func (s *Service) TransferGroupOwner(ctx context.Context, groupID, newOwnerAgentID int64) (*store.GroupChatWithMembers, error) {
	if groupID <= 0 || newOwnerAgentID <= 0 {
		return nil, store.ErrInvalidGroupChatInput
	}
	if err := s.Store.UpdateOwner(ctx, groupID, newOwnerAgentID); err != nil {
		return nil, err
	}
	return s.Store.GetGroupWithMembers(ctx, groupID)
}

// SetGroupMemberTag 设置或清空群内标签。
func (s *Service) SetGroupMemberTag(ctx context.Context, groupID, agentID int64, tag string) (*store.GroupChatWithMembers, error) {
	if groupID <= 0 || agentID <= 0 {
		return nil, store.ErrInvalidGroupChatInput
	}
	if err := s.Store.SetMemberTag(ctx, groupID, agentID, tag); err != nil {
		return nil, err
	}
	return s.Store.GetGroupWithMembers(ctx, groupID)
}
