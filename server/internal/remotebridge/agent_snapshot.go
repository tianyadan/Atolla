package remotebridge

import "atolla/server/internal/store"

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
	return payload
}
