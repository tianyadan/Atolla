package service

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"atolla/server/internal/store"
)

func TestComposeGroupSpeakSystem_WithTagOmitsSkillsFixture(t *testing.T) {
	tagPersona := buildGroupTagPersona("小张", "本群只负责前端评审")
	sys := composeGroupSpeakSystem("协作 · 测", "背景ABC", tagPersona)
	if !strings.Contains(sys, "本群只负责前端评审") {
		t.Fatalf("expected tag in system: %s", sys)
	}
	if !strings.Contains(sys, "【群聊规则】") {
		t.Fatalf("expected group rules: %s", sys)
	}
	if strings.Contains(sys, "Installed skills") || strings.Contains(sys, "skill_catalog") {
		t.Fatalf("tag persona must not include skills fixture, got: %s", sys)
	}
}

func TestComposeGroupSpeakSystem_WithoutTagKeepsPersonaBlock(t *testing.T) {
	sys := composeGroupSpeakSystem("会议", "bg", "你是后端工程师\n\n## Installed skills\n- foo")
	if !strings.Contains(sys, "Installed skills") {
		t.Fatal("without tag should keep original persona/skills block")
	}
}

func TestParseSpeakOrderFromText(t *testing.T) {
	members := []store.GroupChatMember{
		{AgentID: 1, Role: store.GroupMemberRoleOwner},
		{AgentID: 2, Role: store.GroupMemberRoleMember},
		{AgentID: 3, Role: store.GroupMemberRoleMember},
	}
	text := "先 @[甲](#agent:3) 再 @[乙](#agent:2)，我 @[群主](#agent:1) 不点自己"
	got := parseSpeakOrderFromText(text, members, 1)
	if len(got) != 2 || got[0] != 3 || got[1] != 2 {
		t.Fatalf("got %v want [3 2]", got)
	}
}

func TestRunGroupMeeting_SpeakOrderOwnerMembersOwner(t *testing.T) {
	svc := openGroupChatTestService(t)
	st := svc.Store
	ctx := context.Background()

	owner := createGroupChatTestAgent(t, st, "gc-meet-owner")
	m1 := createGroupChatTestAgent(t, st, "gc-meet-m1")
	m2 := createGroupChatTestAgent(t, st, "gc-meet-m2")

	detail, err := svc.CreateGroupChat(ctx, owner, []int64{m1, m2}, "串行开会测试")
	if err != nil {
		t.Fatalf("CreateGroupChat: %v", err)
	}
	cleanupGroupChat(t, st, detail.ID)

	var seq []int64
	speak := func(ctx context.Context, groupID, speakerAgentID int64, prompt string, onEvent AskEventSink) (*store.Message, error) {
		seq = append(seq, speakerAgentID)
		content := "ok"
		if speakerAgentID == owner && strings.Contains(prompt, "群主") {
			content = "请 @[甲](#agent:" + strconv.FormatInt(m1, 10) + ") 然后 @[乙](#agent:" + strconv.FormatInt(m2, 10) + ")"
		}
		emitAsk(onEvent, map[string]any{"type": "speaker", "speaker_agent_id": speakerAgentID})
		return &store.Message{Content: content, Status: "ok"}, nil
	}

	if err := svc.runGroupMeeting(ctx, detail.ID, nil, speak); err != nil {
		t.Fatalf("runGroupMeeting: %v", err)
	}
	want := []int64{owner, m1, m2, owner}
	if len(seq) != len(want) {
		t.Fatalf("seq=%v want %v", seq, want)
	}
	for i := range want {
		if seq[i] != want[i] {
			t.Fatalf("seq=%v want %v", seq, want)
		}
	}
}
