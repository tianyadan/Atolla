package service

import (
	"strings"
	"testing"

	"atolla/server/internal/store"
)

func TestResolveGroupAskSpeakers(t *testing.T) {
	members := []store.GroupChatMember{
		{AgentID: 10}, {AgentID: 20}, {AgentID: 30},
	}
	ownerID := int64(10)

	if got := resolveGroupAskSpeakers("大家好", members, ownerID); len(got) != 0 {
		t.Fatalf("no mention want empty, got %v", got)
	}

	q := "请 @[甲](#agent:20) 和 @[乙](#agent:30) 还有 @[外](#agent:99)"
	got := resolveGroupAskSpeakers(q, members, ownerID)
	if len(got) != 2 || got[0] != 20 || got[1] != 30 {
		t.Fatalf("got %v want [20 30]", got)
	}

	q2 := "@[群主](#agent:10) 总结"
	got2 := resolveGroupAskSpeakers(q2, members, ownerID)
	if len(got2) != 1 || got2[0] != 10 {
		t.Fatalf("got2 %v", got2)
	}
}

func TestBuildGroupAskMemberPrompt(t *testing.T) {
	p := buildGroupAskMemberPrompt("修 bug", "小张")
	if !strings.Contains(p, "修 bug") || !strings.Contains(p, "小张") {
		t.Fatalf("prompt=%q", p)
	}
}
