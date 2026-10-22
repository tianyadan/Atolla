package service

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"atolla/server/config"
	"atolla/server/internal/store"
)

func groupChatTestDSN() string {
	if d := os.Getenv("AVATAR_DB_DSN"); d != "" {
		return d
	}
	return "root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local"
}

func openGroupChatTestService(t *testing.T) *Service {
	t.Helper()
	st, err := store.New(groupChatTestDSN())
	if err != nil {
		t.Skipf("mysql unavailable: %v", err)
	}
	return &Service{Store: st, Cfg: config.Load()}
}

func createGroupChatTestAgent(t *testing.T, st *store.Store, name string) int64 {
	t.Helper()
	id, err := st.CreateManagedAgent(context.Background(), store.ManagedAgentInput{
		Name:   name,
		Engine: "agent",
	})
	if err != nil {
		t.Fatalf("CreateManagedAgent: %v", err)
	}
	// 必须清理：默认连开发库，否则「未入组」会被测试员工刷爆
	t.Cleanup(func() {
		_ = st.DeleteManagedAgent(context.Background(), id)
	})
	return id
}

func cleanupGroupChat(t *testing.T, st *store.Store, groupID int64) {
	t.Helper()
	if groupID <= 0 {
		return
	}
	t.Cleanup(func() {
		_ = st.DeleteGroupChat(context.Background(), groupID)
	})
}

func TestUniqueGroupMemberIDs(t *testing.T) {
	got := uniqueGroupMemberIDs(1, []int64{2, 2, 3, 1, 0})
	if len(got) != 3 || got[0] != 1 || got[1] != 2 || got[2] != 3 {
		t.Fatalf("got %v", got)
	}
}

func TestFormatGroupChatName(t *testing.T) {
	if n := formatGroupChatName("小王", "请一起评审登录模块", fixedTime(2026, 10, 22, 15, 4)); n != "协作 · 请一起评审登录模块" {
		t.Fatalf("seed name: %q", n)
	}
	longSeed := strings.Repeat("需", 25)
	if got := formatGroupChatName("甲", longSeed, fixedTime(2026, 1, 2, 9, 5)); got != "协作 · "+strings.Repeat("需", 20) {
		t.Fatalf("truncate seed: %q", got)
	}
	if got := formatGroupChatName("小王", "  ", fixedTime(2026, 10, 22, 15, 4)); got != "小王的会议 · 1022-1504" {
		t.Fatalf("fallback name: %q", got)
	}
}

func fixedTime(y, m, d, hh, mm int) time.Time {
	return time.Date(y, time.Month(m), d, hh, mm, 0, 0, time.Local)
}

func TestBuildSharedBackgroundFromTurnsCapsAtMax(t *testing.T) {
	turns := []store.Turn{
		{User: strings.Repeat("U", 6000), Assistant: strings.Repeat("A", 6000)},
	}
	got := buildSharedBackgroundFromTurns(turns)
	if n := len([]rune(got)); n != GroupChatSharedBackgroundMaxRunes {
		t.Fatalf("len=%d want %d", n, GroupChatSharedBackgroundMaxRunes)
	}
	// 保留末尾：应含近期助手内容片段
	if !strings.HasSuffix(got, strings.Repeat("A", 100)) {
		t.Fatal("expected tail of assistant text preserved")
	}
}

func TestCreateGroupChatInvalidMemberCount(t *testing.T) {
	svc := openGroupChatTestService(t)
	ctx := context.Background()
	st := svc.Store

	owner := createGroupChatTestAgent(t, st, "gc-svc-owner-2")
	m1 := createGroupChatTestAgent(t, st, "gc-svc-m1-2")

	_, err := svc.CreateGroupChat(ctx, owner, []int64{m1}, "只有两人")
	if !errors.Is(err, ErrGroupChatInvalidMemberCount) {
		t.Fatalf("2 members: got %v", err)
	}

	ids := make([]int64, 0, 5)
	for i := 0; i < 5; i++ {
		ids = append(ids, createGroupChatTestAgent(t, st, "gc-svc-extra-"+string(rune('a'+i))))
	}
	_, err = svc.CreateGroupChat(ctx, owner, ids, "六人")
	if !errors.Is(err, ErrGroupChatInvalidMemberCount) {
		t.Fatalf("6 members: got %v", err)
	}
}

func TestCreateGroupChatSuccess(t *testing.T) {
	svc := openGroupChatTestService(t)
	ctx := context.Background()
	st := svc.Store

	owner := createGroupChatTestAgent(t, st, "gc-svc-owner-ok")
	m1 := createGroupChatTestAgent(t, st, "gc-svc-m1-ok")
	m2 := createGroupChatTestAgent(t, st, "gc-svc-m2-ok")

	seed := "一起梳理发布流程"
	detail, err := svc.CreateGroupChat(ctx, owner, []int64{m1, m2, owner}, seed)
	if err != nil {
		t.Fatalf("CreateGroupChat: %v", err)
	}
	if detail == nil || detail.ID <= 0 {
		t.Fatal("expected group detail")
	}
	cleanupGroupChat(t, st, detail.ID)
	if detail.Name != "协作 · "+seed {
		t.Fatalf("name=%q", detail.Name)
	}
	if len(detail.Members) != 3 {
		t.Fatalf("members=%d", len(detail.Members))
	}
	msgs, err := st.Messages(ctx, detail.SharedConversationID)
	if err != nil {
		t.Fatalf("Messages: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Role != "user" || msgs[0].Content != seed {
		t.Fatalf("seed message: %+v", msgs)
	}
}

func TestCreateGroupChatBackgroundLengthCap(t *testing.T) {
	svc := openGroupChatTestService(t)
	ctx := context.Background()
	st := svc.Store

	owner := createGroupChatTestAgent(t, st, "gc-svc-owner-bg")
	m1 := createGroupChatTestAgent(t, st, "gc-svc-m1-bg")
	m2 := createGroupChatTestAgent(t, st, "gc-svc-m2-bg")

	convID, err := st.CreateAgentConversation(ctx, owner)
	if err != nil {
		t.Fatalf("CreateAgentConversation: %v", err)
	}
	if err := st.SetManagedAgentConversation(ctx, owner, convID); err != nil {
		t.Fatalf("SetManagedAgentConversation: %v", err)
	}
	block := strings.Repeat("背", 5500)
	if _, err := st.InsertMessage(ctx, &store.Message{
		ConversationID: convID, Role: "user", Content: block, Status: "ok",
	}); err != nil {
		t.Fatalf("user msg: %v", err)
	}
	if _, err := st.InsertMessage(ctx, &store.Message{
		ConversationID: convID, Role: "assistant", Content: block, Status: "ok",
	}); err != nil {
		t.Fatalf("assistant msg: %v", err)
	}

	detail, err := svc.CreateGroupChat(ctx, owner, []int64{m1, m2}, "开会")
	if err != nil {
		t.Fatalf("CreateGroupChat: %v", err)
	}
	cleanupGroupChat(t, st, detail.ID)
	if n := len([]rune(detail.SharedBackground)); n != GroupChatSharedBackgroundMaxRunes {
		t.Fatalf("shared_background len=%d want %d", n, GroupChatSharedBackgroundMaxRunes)
	}
}
