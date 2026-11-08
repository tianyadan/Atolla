package remotebridge

import (
	"encoding/json"

	"atolla/server/internal/store"
)

// agentMirrorUsage 是数字员工上下文使用情况，单独传入以保持镜像构造可测试。
type agentMirrorUsage struct {
	UsedTokens       int64
	WindowTokens     int64
	UsedPercent      float64
	Estimated        bool
	ContextSource    string
	ContextUpdatedAt int64
	Anomaly          string
}

func buildAgentMirrorPayload(a store.ManagedAgent, folderName string, usage agentMirrorUsage) map[string]any {
	return buildAgentMirrorPayloadEx(a, folderName, usage, AgentLiveStatus{}, nil)
}

// buildAgentMirrorPayloadEx 附加即时运行态与任务规划快照（灵动岛 / 手机进度条）。
func buildAgentMirrorPayloadEx(
	a store.ManagedAgent,
	folderName string,
	usage agentMirrorUsage,
	live AgentLiveStatus,
	taskPlan map[string]any,
) map[string]any {
	payload := map[string]any{
		"avatar_url":              a.AvatarURL,
		"jelly_color":             a.JellyColor,
		"folder_id":               a.FolderID,
		"folder_name":             folderName,
		"task_plan_enabled":       a.TaskPlanEnabled,
		"auto_review":             a.AutoReview,
		"auto_approve_all":        a.AutoApproveAll,
		"task_unread":             a.TaskUnread,
		"task_unread_kind":        a.TaskUnreadKind,
		"task_unread_at":          nil,
		"task_unread_duration_ms": a.TaskUnreadDurationMs,
		"task_unread_summary":     a.TaskUnreadSummary,
		"used_tokens":             usage.UsedTokens,
		"window_tokens":           usage.WindowTokens,
		"used_percent":            usage.UsedPercent,
		"estimated":               usage.Estimated,
		"context_source":          usage.ContextSource,
		"context_updated_at":      usage.ContextUpdatedAt,
		"anomaly":                 usage.Anomaly,
	}
	if a.TaskUnreadAt != nil {
		payload["task_unread_at"] = a.TaskUnreadAt.Unix()
	}
	if a.RunStartedAt != nil {
		payload["run_started_at"] = a.RunStartedAt.Unix()
	}
	if live.Phase != "" || live.Summary != "" || live.Tool != "" {
		payload["agent_phase"] = live.Phase
		payload["activity_tool"] = live.Tool
		payload["activity_summary"] = live.Summary
		payload["activity_updated_at"] = live.UpdatedAt
	}
	if len(taskPlan) > 0 {
		payload["task_plan"] = taskPlan
	}
	return payload
}

// buildTaskPlanMirror 把 agent_tasks 行整理成手机/灵动岛可读的 task_plan 对象。
func buildTaskPlanMirror(t store.AgentTask) map[string]any {
	out := map[string]any{
		"task_id":   t.TaskID,
		"task_name": t.TaskName,
		"status":    t.Status,
		"progress":  t.Progress,
		"message":   t.Message,
	}
	switch p := t.Payload.(type) {
	case map[string]any:
		for k, v := range p {
			out[k] = v
		}
	case []byte:
		var m map[string]any
		if json.Unmarshal(p, &m) == nil {
			for k, v := range m {
				out[k] = v
			}
		}
	case string:
		var m map[string]any
		if json.Unmarshal([]byte(p), &m) == nil {
			for k, v := range m {
				out[k] = v
			}
		}
	}
	if _, ok := out["schema"]; !ok {
		out["schema"] = "atolla.task_plan.v2"
	}
	return out
}
