package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"atolla/server/internal/store"
)

// GroupChatSharedBackgroundMaxRunes 群共享背景字数上限（仅群主主会话）。
const GroupChatSharedBackgroundMaxRunes = 10000

// recentTurnsForGroupBackground 组装群主背景时拉取的主会话轮次上限。
const recentTurnsForGroupBackground = 800

var (
	// ErrGroupChatInvalidMemberCount 群成员总数（含群主）须为 3～5。
	ErrGroupChatInvalidMemberCount = errors.New("group chat member count must be between 3 and 5")
	// ErrGroupChatAgentNotFound 成员或群主对应的数字员工不存在。
	ErrGroupChatAgentNotFound = errors.New("group chat agent not found")
)

// CreateGroupChat 从当前窗口员工建群：校验人数、截取群主背景、写入 seed 用户消息。
func (s *Service) CreateGroupChat(ctx context.Context, fromAgentID int64, memberAgentIDs []int64, seedQuestion string) (*store.GroupChatWithMembers, error) {
	if fromAgentID <= 0 {
		return nil, ErrGroupChatInvalidMemberCount
	}
	allIDs := uniqueGroupMemberIDs(fromAgentID, memberAgentIDs)
	if n := len(allIDs); n < 3 || n > 5 {
		return nil, ErrGroupChatInvalidMemberCount
	}

	owner, err := s.Store.GetManagedAgent(ctx, fromAgentID)
	if err != nil {
		return nil, err
	}
	if owner == nil {
		return nil, ErrGroupChatAgentNotFound
	}
	for _, id := range allIDs {
		if id == fromAgentID {
			continue
		}
		a, err := s.Store.GetManagedAgent(ctx, id)
		if err != nil {
			return nil, err
		}
		if a == nil {
			return nil, fmt.Errorf("%w: agent %d", ErrGroupChatAgentNotFound, id)
		}
	}

	bg, err := s.buildOwnerSharedBackground(ctx, owner.ConversationID)
	if err != nil {
		return nil, err
	}
	name := formatGroupChatName(owner.Name, seedQuestion, time.Now())
	seed := strings.TrimSpace(seedQuestion)

	groupID, err := s.Store.CreateGroup(ctx, store.CreateGroupInput{
		Name:               name,
		OwnerAgentID:       fromAgentID,
		SharedBackground:   bg,
		CreatedFromAgentID: fromAgentID,
		SeedQuestion:       seed,
		MemberAgentIDs:     nonOwnerMemberIDs(fromAgentID, allIDs),
	})
	if err != nil {
		return nil, err
	}

	detail, err := s.Store.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		return nil, err
	}
	if seed != "" {
		if _, err := s.Store.InsertMessage(ctx, &store.Message{
			ConversationID: detail.SharedConversationID,
			Role:           "user",
			Content:        seed,
			Status:         "ok",
		}); err != nil {
			return nil, err
		}
	}
	return detail, nil
}

// uniqueGroupMemberIDs 去重合并群主与 @ 成员 id。
func uniqueGroupMemberIDs(fromAgentID int64, memberAgentIDs []int64) []int64 {
	seen := map[int64]struct{}{}
	add := func(id int64) {
		if id <= 0 {
			return
		}
		seen[id] = struct{}{}
	}
	add(fromAgentID)
	for _, id := range memberAgentIDs {
		add(id)
	}
	out := make([]int64, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// nonOwnerMemberIDs 返回除群主外的成员 id（传给 store.CreateGroup）。
func nonOwnerMemberIDs(ownerID int64, all []int64) []int64 {
	var out []int64
	for _, id := range all {
		if id != ownerID {
			out = append(out, id)
		}
	}
	return out
}

// formatGroupChatName 自动生成群名：有 seed 用「协作 · …」，否则「{群主}的会议 · 时间」。
func formatGroupChatName(ownerName, seed string, now time.Time) string {
	seed = strings.TrimSpace(seed)
	if seed != "" {
		return "协作 · " + TruncateRunes(seed, 20)
	}
	ownerName = strings.TrimSpace(ownerName)
	if ownerName == "" {
		ownerName = "群主"
	}
	return ownerName + "的会议 · " + now.Format("0102-1504")
}

// buildOwnerSharedBackground 从群主主会话拼接文本并截断至上限。
func (s *Service) buildOwnerSharedBackground(ctx context.Context, conversationID int64) (string, error) {
	if conversationID <= 0 {
		return "", nil
	}
	turns, err := s.Store.RecentTurns(ctx, conversationID, recentTurnsForGroupBackground)
	if err != nil {
		return "", err
	}
	return buildSharedBackgroundFromTurns(turns), nil
}

// buildSharedBackgroundFromTurns 复用 FormatResumeHistory 拼接后按 rune 保留末尾片段。
func buildSharedBackgroundFromTurns(turns []store.Turn) string {
	text := FormatResumeHistory(turns, "")
	return capSharedBackgroundRunes(text, GroupChatSharedBackgroundMaxRunes)
}

// capSharedBackgroundRunes 超长时保留最近 max 个 rune（会议材料偏近期上下文）。
func capSharedBackgroundRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	rs := []rune(s)
	if len(rs) <= max {
		return s
	}
	return string(rs[len(rs)-max:])
}
