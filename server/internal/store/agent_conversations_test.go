package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

// 回归目标：创建新线程时不得清空或覆盖旧线程，只移动数字人的当前会话指针。
func TestAgentConversationCreatePreservesPreviousThread(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	agentID := createTestAgent(t, st, "modern-thread-create")

	first, err := st.CreateAndActivateAgentConversation(ctx, agentID, "第一项工作")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	if _, err := st.InsertMessage(ctx, &Message{ConversationID: first.ID, Role: "user", Content: "保留这条旧消息", Status: "ok"}); err != nil {
		t.Fatalf("insert first message: %v", err)
	}
	second, err := st.CreateAndActivateAgentConversation(ctx, agentID, "第二项工作")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if first.ID == second.ID {
		t.Fatal("new thread reused previous conversation")
	}

	agent, err := st.GetManagedAgent(ctx, agentID)
	if err != nil || agent == nil {
		t.Fatalf("get agent: %v", err)
	}
	if agent.ConversationID != second.ID {
		t.Fatalf("active conversation=%d want %d", agent.ConversationID, second.ID)
	}
	oldMessages, err := st.Messages(ctx, first.ID)
	if err != nil || len(oldMessages) != 1 || oldMessages[0].Content != "保留这条旧消息" {
		t.Fatalf("old thread changed: items=%+v err=%v", oldMessages, err)
	}
}

// 回归目标：激活历史线程只能切换同一数字人的指针，不能接管其他数字人的线程。
func TestAgentConversationActivateRejectsForeignAgent(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	firstAgent := createTestAgent(t, st, "modern-thread-owner-a")
	secondAgent := createTestAgent(t, st, "modern-thread-owner-b")
	first, err := st.CreateAndActivateAgentConversation(ctx, firstAgent, "A 的会话")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := st.ActivateAgentConversation(ctx, secondAgent, first.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign activation error=%v want sql.ErrNoRows", err)
	}
	second, err := st.GetManagedAgent(ctx, secondAgent)
	if err != nil || second == nil {
		t.Fatalf("get second agent: %v", err)
	}
	if second.ConversationID == first.ID {
		t.Fatal("foreign conversation became active")
	}
}

// 回归目标：最近列表必须按活跃时间排序，并为无标题会话提供可读回退。
func TestAgentConversationListOrdersAndFallsBackTitle(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	agentID := createTestAgent(t, st, "modern-thread-list")
	first, err := st.CreateAndActivateAgentConversation(ctx, agentID, "")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	if _, err := st.InsertMessage(ctx, &Message{ConversationID: first.ID, Role: "user", Content: "请帮我排查远程中继登录问题", Status: "ok"}); err != nil {
		t.Fatalf("insert first: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	second, err := st.CreateAndActivateAgentConversation(ctx, agentID, "明确标题")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	items, err := st.ListAgentConversations(ctx, 100, false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var gotFirst, gotSecond *AgentConversationSummary
	for i := range items {
		switch items[i].ID {
		case first.ID:
			gotFirst = &items[i]
		case second.ID:
			gotSecond = &items[i]
		}
	}
	if gotFirst == nil || gotFirst.Title != "请帮我排查远程中继登录问题" {
		t.Fatalf("fallback title=%+v", gotFirst)
	}
	if gotSecond == nil || gotSecond.Title != "明确标题" || !gotSecond.Active {
		t.Fatalf("explicit title/current=%+v", gotSecond)
	}
	if gotSecond.UpdatedAt.Before(gotFirst.UpdatedAt) {
		t.Fatalf("newest thread ordered behind old thread: new=%v old=%v", gotSecond.UpdatedAt, gotFirst.UpdatedAt)
	}
}
