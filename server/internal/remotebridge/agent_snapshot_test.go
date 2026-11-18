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
		Model:                "gpt-6.2-astra",
	}, "研发部", agentMirrorUsage{UsedTokens: 12, WindowTokens: 100, UsedPercent: 12})

	if payload["folder_name"] != "研发部" || payload["task_unread_kind"] != "completed" {
		t.Fatalf("payload identity = %#v", payload)
	}
	if payload["task_unread_at"] != at.Unix() || payload["task_unread_duration_ms"] != 4567 || payload["task_unread_summary"] != "done" {
		t.Fatalf("payload snapshot = %#v", payload)
	}
	if payload["model"] != "gpt-6.2-astra" {
		t.Fatalf("model = %#v", payload["model"])
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

func TestBuildAgentMirrorPayloadExLiveAndTaskPlan(t *testing.T) {
	payload := buildAgentMirrorPayloadEx(
		store.ManagedAgent{TaskPlanEnabled: true, JellyColor: "purple"},
		"产品部",
		agentMirrorUsage{},
		AgentLiveStatus{Phase: "working", Tool: "Bash", Summary: "正在执行测试", UpdatedAt: 1_700_000_100},
		map[string]any{
			"schema":       "atolla.task_plan.v1",
			"phase":        "running",
			"progress":     40,
			"message":      "实现进度条",
			"current_step": 1,
			"total_count":  4,
		},
	)
	if payload["task_plan_enabled"] != true {
		t.Fatalf("task_plan_enabled = %#v", payload["task_plan_enabled"])
	}
	if payload["agent_phase"] != "working" || payload["activity_tool"] != "Bash" || payload["activity_summary"] != "正在执行测试" {
		t.Fatalf("live fields = %#v", payload)
	}
	plan, ok := payload["task_plan"].(map[string]any)
	if !ok || plan["progress"] != 40 || plan["phase"] != "running" || plan["message"] != "实现进度条" {
		t.Fatalf("task_plan = %#v", payload["task_plan"])
	}
}
