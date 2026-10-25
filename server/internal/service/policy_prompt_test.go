package service

import (
	"strings"
	"testing"

	"atolla/server/internal/store"
)

func TestAgentPolicyBlockAndReinforce(t *testing.T) {
	a := &store.ManagedAgent{
		Name: "x", AllowWrite: false, AllowNetwork: false, AllowRm: false,
		WorkspacePath: "/tmp/ws",
	}
	block := AgentPolicyBlock(a)
	if !strings.Contains(block, "禁止") || !strings.Contains(block, "/tmp/ws") {
		t.Fatalf("bad block: %s", block)
	}
	q := MaybeReinforcePolicy(a, 10, "hello")
	if !strings.Contains(q, "策略重申") || !strings.Contains(q, "hello") {
		t.Fatalf("bad reinforce: %s", q)
	}
	if MaybeReinforcePolicy(a, 9, "hello") != "hello" {
		t.Fatal("should not reinforce on turn 9")
	}
}

// 未限制工作区：策略条文须明确允许全盘读写，不得再写「仅限已授权工作区」。
func TestAgentPolicyBlockUnboundAllowsFullFS(t *testing.T) {
	a := &store.ManagedAgent{Name: "x", AllowWrite: true, AllowNetwork: true}
	block := AgentPolicyBlock(a)
	if !strings.Contains(block, "未限制") || !strings.Contains(block, "任意路径") {
		t.Fatalf("unbound should allow full FS: %s", block)
	}
	if strings.Contains(block, "已授权工作区") {
		t.Fatalf("must not restrict to authorized workspaces when unbound: %s", block)
	}
}

func TestBuildAgentSystemPromptIncludesProjectMemory(t *testing.T) {
	a := &store.ManagedAgent{Name: "x", RulesPrompt: "hi"}
	p := BuildAgentSystemPrompt(a)
	if !strings.Contains(p, "projects/*/summary.md") {
		t.Fatalf("missing project memory hint: %s", p)
	}
}
