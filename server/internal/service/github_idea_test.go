package service

import (
	"strings"
	"testing"

	"atolla/server/internal/plugin/githubidea"
)

func TestBuildGitHubIdeaTaskOnlyIncludesIdeaAndMinimalSource(t *testing.T) {
	event := githubidea.PreparedEvent{
		Action:        "opened",
		Repository:    "tianyadan/atolla-idea",
		IssueNumber:   1,
		IssueTitle:    "Issue title",
		IssueURL:      "https://github.com/tianyadan/atolla-idea/issues/1",
		IssueRevision: "2026-11-08T10:00:00Z",
	}
	idea := githubidea.Idea{
		ID:      "ISSUE-1",
		Title:   "优化 Agent 选择交互",
		Content: "将 Agent 列表收纳到弹窗中。",
	}

	prompt := buildGitHubIdeaTask(event, idea)
	for _, expected := range []string{
		"标题：优化 Agent 选择交互",
		"将 Agent 列表收纳到弹窗中。",
		"来源：tianyadan/atolla-idea Issue #1",
		"Idea ID：ISSUE-1",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q: %s", expected, prompt)
		}
	}
	for _, unwanted := range []string{"IDEA_RULES.md", "pull_request.opened", "PR 内容", "事件："} {
		if strings.Contains(prompt, unwanted) {
			t.Fatalf("prompt contains unrelated content %q: %s", unwanted, prompt)
		}
	}
}

func TestGitHubIssueDispatchMetadata(t *testing.T) {
	event := githubidea.PreparedEvent{Repository: "Acme/Ideas", IssueNumber: 8, IssueRevision: "REV-1"}
	idea := githubidea.Idea{ID: "ISSUE-8"}
	if got := githubIssueSourceKey(event); got != "acme/ideas#8" {
		t.Fatalf("source key=%q", got)
	}
	if got := githubIdeaDedupKey(event, idea); got != "acme/ideas#issue-8#rev-1" {
		t.Fatalf("dedup key=%q", got)
	}
	if got := githubIssuePriority([]string{"bug", "priority:high"}); got != "high" {
		t.Fatalf("priority=%q", got)
	}
	if got := githubIssueExplicitAgentID([]string{"backend", "agent-id:42"}); got != 42 {
		t.Fatalf("explicit agent=%d", got)
	}
}
