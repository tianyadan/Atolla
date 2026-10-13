package remotebridge

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

const defaultMessageSyncLimit = 200

// handlePing responds to cloud probe.
func handlePing(_ *ExecContext) (any, error) {
	return map[string]any{"pong": true, "ts": time.Now().UnixMilli()}, nil
}

// handleSyncAgents loads managed agents and pushes agents snapshot.
func handleSyncAgents(ec *ExecContext) (any, error) {
	agents, err := ec.Store.ListManagedAgents(ec.Context)
	if err != nil {
		return nil, err
	}
	if len(agents) == 0 {
		return map[string]any{"skipped": true, "reason": "no agents"}, nil
	}
	rows := make([]map[string]any, 0, len(agents))
	for _, a := range agents {
		rows = append(rows, map[string]any{
			"agent_id":     strconv.FormatInt(a.ID, 10),
			"display_name": a.Name,
			"engine":       a.Engine,
			"status":       a.Status,
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
		rows = append(rows, map[string]any{
			"message_id": strconv.FormatInt(m.ID, 10),
			"agent_id":   agentIDStr,
			"role":       m.Role,
			"content":    m.Content,
			"created_at": m.CreatedAt.UnixMilli(),
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
