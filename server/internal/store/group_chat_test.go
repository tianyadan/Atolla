package store

import (
	"context"
	"os"
	"strings"
	"testing"
)

func testStoreDSN() string {
	if d := os.Getenv("AVATAR_DB_DSN"); d != "" {
		return d
	}
	return "root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local"
}

// openTestStore 连接本地 MySQL；不可用时跳过测试。
func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := New(testStoreDSN())
	if err != nil {
		t.Skipf("mysql unavailable: %v", err)
	}
	return st
}

func createTestAgent(t *testing.T, st *Store, name string) int64 {
	t.Helper()
	ctx := context.Background()
	id, err := st.CreateManagedAgent(ctx, ManagedAgentInput{
		Name:   name,
		Engine: "agent",
	})
	if err != nil {
		t.Fatalf("CreateManagedAgent: %v", err)
	}
	// 必须清理：默认连的是开发库，否则会污染「未入组」
	t.Cleanup(func() {
		_ = st.DeleteManagedAgent(context.Background(), id)
	})
	return id
}

/** 建群后注册清理，避免测试群残留 */
func createTestGroup(t *testing.T, st *Store, in CreateGroupInput) int64 {
	t.Helper()
	id, err := st.CreateGroup(context.Background(), in)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DeleteGroupChat(context.Background(), id)
	})
	return id
}

func TestCreateGroup(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	owner := createTestAgent(t, st, "group-test-owner")
	m1 := createTestAgent(t, st, "group-test-m1")
	m2 := createTestAgent(t, st, "group-test-m2")

	groupID := createTestGroup(t, st, CreateGroupInput{
		Name:               "协作 · 测试群",
		OwnerAgentID:       owner,
		SharedBackground:   "背景摘要",
		CreatedFromAgentID: owner,
		SeedQuestion:       "今天讨论什么？",
		MemberAgentIDs:     []int64{m1, m2},
	})
	if groupID <= 0 {
		t.Fatal("expected positive group id")
	}

	detail, err := st.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroupWithMembers: %v", err)
	}
	if detail.SharedConversationID <= 0 {
		t.Fatal("shared_conversation_id not set")
	}
	if detail.OwnerAgentID != owner || detail.SeedQuestion != "今天讨论什么？" {
		t.Fatalf("unexpected group: %+v", detail.GroupChat)
	}
	if len(detail.Members) != 3 {
		t.Fatalf("want 3 members, got %d", len(detail.Members))
	}
	var mode string
	if err := st.db.QueryRowContext(ctx,
		`SELECT mode FROM conversations WHERE id=?`, detail.SharedConversationID).Scan(&mode); err != nil {
		t.Fatalf("load conversation mode: %v", err)
	}
	if mode != conversationModeGroupChat {
		t.Fatalf("conversation mode=%q want %q", mode, conversationModeGroupChat)
	}
}

func TestListGroups(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	owner := createTestAgent(t, st, "list-groups-owner")
	m1 := createTestAgent(t, st, "list-groups-m1")
	m2 := createTestAgent(t, st, "list-groups-m2")

	name := "列表测试群"
	id := createTestGroup(t, st, CreateGroupInput{
		Name:               name,
		OwnerAgentID:       owner,
		CreatedFromAgentID: owner,
		MemberAgentIDs:     []int64{m1, m2},
	})

	list, err := st.ListGroups(ctx, GroupChatStatusActive)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	found := false
	for _, g := range list {
		if g.ID == id && g.Name == name {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("group %d not in list (%d items)", id, len(list))
	}
}

func TestGetGroupWithMembers(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	owner := createTestAgent(t, st, "get-group-owner")
	m1 := createTestAgent(t, st, "get-group-m1")
	m2 := createTestAgent(t, st, "get-group-m2")

	groupID := createTestGroup(t, st, CreateGroupInput{
		Name:               "详情群",
		OwnerAgentID:       owner,
		CreatedFromAgentID: owner,
		MemberAgentIDs:     []int64{m1, m2, owner},
	})

	detail, err := st.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroupWithMembers: %v", err)
	}
	roles := map[int64]string{}
	for _, m := range detail.Members {
		roles[m.AgentID] = m.Role
	}
	if roles[owner] != GroupMemberRoleOwner {
		t.Fatalf("owner role=%q", roles[owner])
	}
	if roles[m1] != GroupMemberRoleMember || roles[m2] != GroupMemberRoleMember {
		t.Fatalf("member roles: %+v", roles)
	}
}

func TestUpdateOwner(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	owner := createTestAgent(t, st, "transfer-owner")
	m1 := createTestAgent(t, st, "transfer-m1")
	m2 := createTestAgent(t, st, "transfer-m2")

	groupID := createTestGroup(t, st, CreateGroupInput{
		Name:               "转让群",
		OwnerAgentID:       owner,
		CreatedFromAgentID: owner,
		MemberAgentIDs:     []int64{m1, m2},
	})

	if err := st.UpdateOwner(ctx, groupID, m1); err != nil {
		t.Fatalf("UpdateOwner: %v", err)
	}
	detail, err := st.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroupWithMembers: %v", err)
	}
	if detail.OwnerAgentID != m1 {
		t.Fatalf("owner_agent_id=%d want %d", detail.OwnerAgentID, m1)
	}
	for _, m := range detail.Members {
		switch m.AgentID {
		case m1:
			if m.Role != GroupMemberRoleOwner {
				t.Fatalf("new owner role=%q", m.Role)
			}
		case owner:
			if m.Role != GroupMemberRoleMember {
				t.Fatalf("old owner role=%q", m.Role)
			}
		}
	}
}

func TestSetMemberTag(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	owner := createTestAgent(t, st, "tag-owner")
	m1 := createTestAgent(t, st, "tag-m1")
	m2 := createTestAgent(t, st, "tag-m2")

	groupID := createTestGroup(t, st, CreateGroupInput{
		Name:               "标签群",
		OwnerAgentID:       owner,
		CreatedFromAgentID: owner,
		MemberAgentIDs:     []int64{m1, m2},
	})

	tag := "本群只负责前端评审"
	if err := st.SetMemberTag(ctx, groupID, m1, tag); err != nil {
		t.Fatalf("SetMemberTag: %v", err)
	}
	detail, err := st.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroupWithMembers: %v", err)
	}
	var got string
	for _, m := range detail.Members {
		if m.AgentID == m1 {
			got = m.GroupTag
		}
	}
	if got != tag {
		t.Fatalf("group_tag=%q want %q", got, tag)
	}

	if err := st.SetMemberTag(ctx, groupID, m1, "  "); err != nil {
		t.Fatalf("clear tag: %v", err)
	}
	detail, err = st.GetGroupWithMembers(ctx, groupID)
	if err != nil {
		t.Fatalf("GetGroupWithMembers: %v", err)
	}
	for _, m := range detail.Members {
		if m.AgentID == m1 && strings.TrimSpace(m.GroupTag) != "" {
			t.Fatalf("expected empty tag, got %q", m.GroupTag)
		}
	}
}
