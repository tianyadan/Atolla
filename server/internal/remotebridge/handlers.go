package remotebridge

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/agent"
)

const defaultMessageSyncLimit = 200

// handlePing responds to cloud probe.
func handlePing(_ *ExecContext) (any, error) {
	return map[string]any{"pong": true, "ts": time.Now().UnixMilli()}, nil
}

// handleSyncAgents loads managed agents and pushes agents snapshot (with folder/avatar/plan).
func handleSyncAgents(ec *ExecContext) (any, error) {
	agents, err := ec.Store.ListManagedAgents(ec.Context)
	if err != nil {
		return nil, err
	}
	folderName := map[int64]string{}
	if folders, ferr := ec.Store.ListAgentFolders(ec.Context); ferr == nil {
		for _, f := range folders {
			folderName[f.ID] = f.Name
		}
	}
	// Empty list still posts so relay can prune deleted agents from the mirror.
	rows := make([]map[string]any, 0, len(agents))
	for _, a := range agents {
		fn := ""
		if a.FolderID > 0 {
			fn = folderName[a.FolderID]
		}
		// 与 PC /admin/agents/:id/context 同源：会话 meta + PercentOf / InferEstimated
		usedTokens := int64(0)
		windowTokens := a.ContextWindowTokens
		ctxSource := ""
		ctxUpdated := int64(0)
		anomaly := ""
		if a.ConversationID > 0 {
			if meta, merr := ec.Store.GetConversationEngineMeta(ec.Context, a.ConversationID); merr == nil {
				usedTokens = meta.UsedTokens
				if meta.WindowTokens > 0 {
					windowTokens = meta.WindowTokens
				}
				ctxSource = meta.ContextSource
				ctxUpdated = meta.ContextUpdatedAt
			}
		}
		estimated := agent.InferEstimated(a.Engine, ctxSource)
		usedPercent := agent.PercentOf(usedTokens, windowTokens)
		if usedPercent > 100 {
			anomaly = fmt.Sprintf("current_context_exceeds_window: used=%d window=%d", usedTokens, windowTokens)
		}
		payload := map[string]any{
			"avatar_url":         a.AvatarURL,
			"jelly_color":        a.JellyColor,
			"folder_id":          a.FolderID,
			"folder_name":        fn,
			"task_plan_enabled":  a.TaskPlanEnabled,
			"auto_review":        a.AutoReview,
			"auto_approve_all":   a.AutoApproveAll,
			"task_unread":        a.TaskUnread,
			"used_tokens":        usedTokens,
			"window_tokens":      windowTokens,
			"used_percent":       usedPercent,
			"estimated":          estimated,
			"context_source":     ctxSource,
			"context_updated_at": ctxUpdated,
			"anomaly":            anomaly,
		}
		if a.RunStartedAt != nil {
			payload["run_started_at"] = a.RunStartedAt.Unix()
		}
		rows = append(rows, map[string]any{
			"agent_id":     strconv.FormatInt(a.ID, 10),
			"display_name": a.Name,
			"engine":       a.Engine,
			"status":       a.Status,
			"payload":      payload,
		})
	}
	if err := ec.Client.PostAgentsSnapshot(ec.Context, rows); err != nil {
		return nil, err
	}
	return map[string]any{"upserted": len(rows)}, nil
}

// handleSyncTasks loads agent tasks and pushes tasks snapshot.
func handleSyncTasks(ec *ExecContext) (any, error) {
	tasks, err := ec.Store.AgentTasks(ec.Context, "", "")
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return map[string]any{"skipped": true, "reason": "no tasks"}, nil
	}
	rows := make([]map[string]any, 0, len(tasks))
	for _, t := range tasks {
		agentID := strings.TrimSpace(t.AgentID)
		if agentID == "" {
			agentID = t.AgentType
		}
		rows = append(rows, map[string]any{
			"agent_id": agentID,
			"task_id":  t.TaskID,
			"status":   t.Status,
			"payload": map[string]any{
				"task_name": t.TaskName,
				"progress":  t.Progress,
				"message":   t.Message,
			},
		})
	}
	if err := ec.Client.PostTasksSnapshot(ec.Context, rows); err != nil {
		return nil, err
	}
	return map[string]any{"upserted": len(rows)}, nil
}

// handleSyncMessages loads conversation messages for one managed agent.
func handleSyncMessages(ec *ExecContext) (any, error) {
	agentIDStr, _ := ec.Payload["agent_id"].(string)
	agentIDStr = strings.TrimSpace(agentIDStr)
	if agentIDStr == "" {
		return nil, fmt.Errorf("agent_id required")
	}
	agentNum, err := strconv.ParseInt(agentIDStr, 10, 64)
	if err != nil || agentNum <= 0 {
		return nil, fmt.Errorf("invalid agent_id")
	}
	ag, err := ec.Store.GetManagedAgent(ec.Context, agentNum)
	if err != nil || ag == nil {
		return nil, fmt.Errorf("agent not found")
	}
	if ag.ConversationID <= 0 {
		return map[string]any{"skipped": true, "reason": "no conversation"}, nil
	}
	limit := defaultMessageSyncLimit
	if v, ok := ec.Payload["limit"]; ok {
		switch n := v.(type) {
		case float64:
			limit = int(n)
		case int:
			limit = n
		}
	}
	if limit <= 0 || limit > 200 {
		limit = defaultMessageSyncLimit
	}
	var beforeID int64
	if v, ok := ec.Payload["before_id"].(string); ok && strings.TrimSpace(v) != "" {
		beforeID, _ = strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	}
	msgs, _, _, err := ec.Store.MessagesPage(ec.Context, ag.ConversationID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	if len(msgs) == 0 {
		return map[string]any{"skipped": true, "reason": "no messages"}, nil
	}
	rows := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		payload := map[string]any{}
		if strings.TrimSpace(m.MetaJSON) != "" {
			var meta map[string]any
			if json.Unmarshal([]byte(m.MetaJSON), &meta) == nil {
				if atts, ok := meta["attachments"]; ok {
					payload["attachments"] = atts
				}
				if cid, ok := meta["callee_id"]; ok {
					payload["callee_id"] = cid
				}
				if cn, ok := meta["callee_name"]; ok {
					payload["callee_name"] = cn
				}
				if cn, ok := meta["caller_name"]; ok {
					payload["caller_name"] = cn
				}
			}
		}
		if st := strings.TrimSpace(m.Status); st != "" {
			payload["status"] = st
		}
		// Flatten command JSON so mobile can style risk/decision like PC.
		if m.Role == "command" {
			raw := strings.TrimSpace(m.Content)
			if strings.HasPrefix(raw, "{") {
				var cmd map[string]any
				if json.Unmarshal([]byte(raw), &cmd) == nil {
					if c, ok := cmd["command"].(string); ok && strings.TrimSpace(c) != "" {
						payload["command"] = c
					}
					if d, ok := cmd["decision"].(string); ok {
						payload["decision"] = d
					}
					if r, ok := cmd["risk"].(string); ok {
						payload["risk"] = r
					}
					if meaning, ok := cmd["meaning"].(string); ok {
						payload["meaning"] = meaning
					}
					if by, ok := cmd["by"].(string); ok {
						payload["by"] = by
					}
					if note, ok := cmd["note"].(string); ok {
						payload["note"] = note
					}
				}
			}
			if payload["decision"] == nil && m.Status == "denied" {
				payload["decision"] = "deny"
			}
		}
		content := m.Content
		if cmdText, ok := payload["command"].(string); ok && strings.TrimSpace(cmdText) != "" {
			content = cmdText
		}
		rows = append(rows, map[string]any{
			"message_id": strconv.FormatInt(m.ID, 10),
			"agent_id":   agentIDStr,
			"role":       m.Role,
			"content":    content,
			"created_at": m.CreatedAt.UnixMilli(),
			"payload":    payload,
		})
	}
	if err := ec.Client.PostMessagesSnapshot(ec.Context, rows); err != nil {
		return nil, err
	}
	return map[string]any{"upserted": len(rows)}, nil
}

// PushAgentsTasksSnapshots pushes agents and tasks mirrors (periodic loop).
func PushAgentsTasksSnapshots(ec *ExecContext) error {
	if _, err := handleSyncAgents(ec); err != nil {
		return err
	}
	if _, err := handleSyncTasks(ec); err != nil {
		return err
	}
	return nil
}
