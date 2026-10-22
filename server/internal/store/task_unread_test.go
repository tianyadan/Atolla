package store

import (
	"context"
	"testing"
	"time"
)

func TestManagedAgentTerminalUnreadSnapshot(t *testing.T) {
	st := openTestStore(t)
	id := createTestAgent(t, st, "terminal-unread-completed")
	ctx := context.Background()

	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set running: %v", err)
	}
	before := time.Now().Add(-time.Second)
	if err := st.SetManagedAgentStatus(ctx, id, "idle", "", 4321, 0); err != nil {
		t.Fatalf("set idle: %v", err)
	}

	a, err := st.GetManagedAgent(ctx, id)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if !a.TaskUnread || a.TaskUnreadKind != "completed" {
		t.Fatalf("terminal snapshot = unread:%v kind:%q, want true/completed", a.TaskUnread, a.TaskUnreadKind)
	}
	if a.TaskUnreadAt == nil || a.TaskUnreadAt.Before(before) {
		t.Fatalf("task_unread_at = %v, want recent timestamp", a.TaskUnreadAt)
	}
	if a.TaskUnreadDurationMs != 4321 {
		t.Fatalf("task_unread_duration_ms = %d, want 4321", a.TaskUnreadDurationMs)
	}
	if a.TaskUnreadSummary != "" {
		t.Fatalf("task_unread_summary = %q, want empty", a.TaskUnreadSummary)
	}
}

func TestManagedAgentErrorUnreadSnapshot(t *testing.T) {
	st := openTestStore(t)
	id := createTestAgent(t, st, "terminal-unread-error")
	ctx := context.Background()

	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set running: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "error", "native task failed", 8765, 0); err != nil {
		t.Fatalf("set error: %v", err)
	}

	a, err := st.GetManagedAgent(ctx, id)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if !a.TaskUnread || a.TaskUnreadKind != "error" {
		t.Fatalf("error snapshot = unread:%v kind:%q, want true/error", a.TaskUnread, a.TaskUnreadKind)
	}
	if a.TaskUnreadAt == nil || a.TaskUnreadDurationMs != 8765 || a.TaskUnreadSummary != "native task failed" {
		t.Fatalf("error snapshot = at:%v duration:%d summary:%q", a.TaskUnreadAt, a.TaskUnreadDurationMs, a.TaskUnreadSummary)
	}
}

func TestManagedAgentUnreadLatestWins(t *testing.T) {
	st := openTestStore(t)
	id := createTestAgent(t, st, "terminal-unread-latest")
	ctx := context.Background()

	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set first running: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "error", "first error", 100, 0); err != nil {
		t.Fatalf("set first error: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set second running: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "idle", "", 200, 0); err != nil {
		t.Fatalf("set second idle: %v", err)
	}

	a, err := st.GetManagedAgent(ctx, id)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if a.TaskUnreadKind != "completed" || a.TaskUnreadDurationMs != 200 || a.TaskUnreadSummary != "" {
		t.Fatalf("latest snapshot = kind:%q duration:%d summary:%q", a.TaskUnreadKind, a.TaskUnreadDurationMs, a.TaskUnreadSummary)
	}
}

func TestManagedAgentStartDoesNotClearUnread(t *testing.T) {
	st := openTestStore(t)
	id := createTestAgent(t, st, "terminal-unread-preserve")
	ctx := context.Background()

	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set first running: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "error", "keep me", 300, 0); err != nil {
		t.Fatalf("set error: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set next running: %v", err)
	}

	a, err := st.GetManagedAgent(ctx, id)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if !a.TaskUnread || a.TaskUnreadKind != "error" || a.TaskUnreadDurationMs != 300 || a.TaskUnreadSummary != "keep me" {
		t.Fatalf("preserved snapshot = unread:%v kind:%q duration:%d summary:%q", a.TaskUnread, a.TaskUnreadKind, a.TaskUnreadDurationMs, a.TaskUnreadSummary)
	}
}

func TestClearManagedAgentTaskUnreadClearsSnapshot(t *testing.T) {
	st := openTestStore(t)
	id := createTestAgent(t, st, "terminal-unread-clear")
	ctx := context.Background()

	if err := st.SetManagedAgentStatus(ctx, id, "running", "", 0, 0); err != nil {
		t.Fatalf("set running: %v", err)
	}
	if err := st.SetManagedAgentStatus(ctx, id, "error", "clear me", 400, 0); err != nil {
		t.Fatalf("set error: %v", err)
	}
	if err := st.ClearManagedAgentTaskUnread(ctx, id); err != nil {
		t.Fatalf("clear unread: %v", err)
	}

	a, err := st.GetManagedAgent(ctx, id)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if a.TaskUnread || a.TaskUnreadKind != "" || a.TaskUnreadAt != nil || a.TaskUnreadDurationMs != 0 || a.TaskUnreadSummary != "" {
		t.Fatalf("cleared snapshot = unread:%v kind:%q at:%v duration:%d summary:%q", a.TaskUnread, a.TaskUnreadKind, a.TaskUnreadAt, a.TaskUnreadDurationMs, a.TaskUnreadSummary)
	}
}
