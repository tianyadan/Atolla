package remotebridge

import (
	"testing"
	"time"

	"atolla/server/internal/store"
)

func TestBuildAgentMirrorPayloadCompletedSnapshot(t *testing.T) {
	at := time.Date(2026, 10, 23, 8, 30, 0, 0, time.Local)
	payload := buildAgentMirrorPayload(store.ManagedAgent{
		AvatarURL:            "/avatar.png",
		JellyColor:           "green",
		FolderID:             7,
		TaskUnread:           true,
		TaskUnreadKind:       "completed",
		TaskUnreadAt:         &at,
		TaskUnreadDurationMs: 4567,
		TaskUnreadSummary:    "done",
	}, "研发部", agentMirrorUsage{UsedTokens: 12, WindowTokens: 100, UsedPercent: 12})

	if payload["folder_name"] != "研发部" || payload["task_unread_kind"] != "completed" {
		t.Fatalf("payload identity = %#v", payload)
	}
	if payload["task_unread_at"] != at.Unix() || payload["task_unread_duration_ms"] != 4567 || payload["task_unread_summary"] != "done" {
		t.Fatalf("payload snapshot = %#v", payload)
	}
}

func TestBuildAgentMirrorPayloadErrorSnapshot(t *testing.T) {
	at := time.Date(2026, 10, 23, 9, 15, 0, 0, time.Local)
	payload := buildAgentMirrorPayload(store.ManagedAgent{
		TaskUnread:           true,
		TaskUnreadKind:       "error",
		TaskUnreadAt:         &at,
		TaskUnreadDurationMs: 987,
		TaskUnreadSummary:    "command failed",
	}, "运维部", agentMirrorUsage{})

	if payload["task_unread_kind"] != "error" || payload["task_unread_summary"] != "command failed" {
		t.Fatalf("payload error snapshot = %#v", payload)
	}
}

func TestBuildAgentMirrorPayloadBlankSnapshot(t *testing.T) {
	payload := buildAgentMirrorPayload(store.ManagedAgent{TaskUnread: false}, "", agentMirrorUsage{})

	if payload["task_unread_kind"] != "" || payload["task_unread_at"] != nil || payload["task_unread_duration_ms"] != 0 || payload["task_unread_summary"] != "" {
		t.Fatalf("blank snapshot invented details: %#v", payload)
	}
}
