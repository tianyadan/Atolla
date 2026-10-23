package service

import (
	"testing"
	"time"

	"atolla/server/internal/store"
)

func TestSelectIslandPresentationPriorityAndLimit(t *testing.T) {
	events := []IslandEvent{
		{ID: "completed:1", Kind: IslandEventCompleted, OccurredAt: "2026-10-23T08:00:00Z"},
		{ID: "approval:a", Kind: IslandEventApproval, OccurredAt: "2026-10-23T09:00:00Z"},
		{ID: "error:2", Kind: IslandEventError, OccurredAt: "2026-10-23T10:00:00Z"},
		{ID: "error:3", Kind: IslandEventError, OccurredAt: "2026-10-23T11:00:00Z"},
	}

	got := selectIslandPresentation(events, 1)
	if got.ActiveKind != IslandEventError || got.Count != 2 || len(got.Items) != 1 {
		t.Fatalf("unexpected presentation: %+v", got)
	}
	if got.Items[0].ID != "error:3" {
		t.Fatalf("expected newest error first, got %q", got.Items[0].ID)
	}
}

func TestBuildIslandEventsTerminalAndRunning(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	completedAt := now.Add(-time.Minute)
	errorAt := now.Add(-2 * time.Minute)
	startedAt := now.Add(-30 * time.Second)
	agents := []store.ManagedAgent{
		{ID: 1, Name: "完成员工", FolderName: "设计部", TaskUnread: true, TaskUnreadKind: "completed", TaskUnreadAt: &completedAt, TaskUnreadDurationMs: 65000, TaskUnreadSummary: "已交付"},
		{ID: 2, Name: "报错员工", FolderName: "研发部", TaskUnread: true, TaskUnreadKind: "error", TaskUnreadAt: &errorAt, TaskUnreadDurationMs: 8000, TaskUnreadSummary: "编译失败"},
		{ID: 3, Name: "运行员工", Status: "running", RunStartedAt: &startedAt},
		{ID: 4, Name: "脏快照", TaskUnread: true, TaskUnreadKind: "unknown", TaskUnreadAt: &completedAt},
	}

	got := buildIslandEvents(agents, nil, nil, now)
	if len(got) != 3 {
		t.Fatalf("expected 3 valid events, got %d: %+v", len(got), got)
	}
	if got[0].Kind != IslandEventCompleted || got[0].DurationMs != 65000 || got[0].GroupName != "设计部" {
		t.Fatalf("unexpected completed event: %+v", got[0])
	}
	if got[1].Kind != IslandEventError || got[1].Summary != "编译失败" {
		t.Fatalf("unexpected error event: %+v", got[1])
	}
	if got[2].Kind != IslandEventRunning || got[2].OccurredAt != startedAt.Format(time.RFC3339) {
		t.Fatalf("unexpected running event: %+v", got[2])
	}
}

func TestBuildIslandEventsApprovalAndWorkflowRunning(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	agents := []store.ManagedAgent{{ID: 7, Name: "小七", FolderName: "工程部"}, {ID: 8, Name: "小八"}}
	approvals := []islandApproval{
		{RequestID: "req-1", AgentID: 7, Summary: "执行部署命令", CreatedAt: now.Add(-time.Minute)},
		{RequestID: "orphan", AgentID: 99, Summary: "应忽略", CreatedAt: now},
	}
	occupancy := map[int64]store.Occupancy{8: {AgentID: 8, SourceType: "WORKFLOW", StartedAt: now.Add(-2 * time.Minute)}}

	got := buildIslandEvents(agents, occupancy, approvals, now)
	if len(got) != 2 {
		t.Fatalf("expected approval and workflow event, got %+v", got)
	}
	byKind := map[string]IslandEvent{}
	for _, event := range got {
		byKind[event.Kind] = event
	}
	if event := byKind[IslandEventApproval]; event.RequestID != "req-1" || event.AgentID != 7 {
		t.Fatalf("unexpected approval: %+v", event)
	}
	if event := byKind[IslandEventRunning]; event.AgentID != 8 {
		t.Fatalf("unexpected workflow running: %+v", event)
	}
}
