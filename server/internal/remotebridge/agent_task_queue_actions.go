package remotebridge

import (
	"fmt"
	"strconv"
	"strings"
)

func payloadMode(payload map[string]interface{}) string {
	raw, _ := payload["mode"].(string)
	return strings.ToLower(strings.TrimSpace(raw))
}

func payloadTaskID(payload map[string]interface{}) (int64, error) {
	switch n := payload["task_id"].(type) {
	case float64:
		if n > 0 {
			return int64(n), nil
		}
	case int64:
		if n > 0 {
			return n, nil
		}
	case int:
		if n > 0 {
			return int64(n), nil
		}
	case string:
		id, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		if err != nil || id <= 0 {
			return 0, fmt.Errorf("invalid task_id")
		}
		return id, nil
	}
	return 0, fmt.Errorf("task_id required")
}

// handleAgentAsk — 支持 payload.mode（interrupt / enqueue / direct）。
func handleAgentAsk(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	q, _ := ec.Payload["question"].(string)
	q = strings.TrimSpace(q)
	atts := payloadChatAtts(ec.Payload)
	if q == "" && len(atts) == 0 {
		return nil, fmt.Errorf("question required")
	}
	mode := payloadMode(ec.Payload)
	if err := ec.Runtime.AskManagedBackground(ec.Context, agentID, q, atts, mode); err != nil {
		return nil, err
	}
	return map[string]any{
		"accepted": true,
		"agent_id": strconv.FormatInt(agentID, 10),
		"mode":     mode,
	}, nil
}

func handleAgentTaskQueueList(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	return ec.Runtime.ListAgentTaskQueue(ec.Context, agentID)
}

func handleAgentTaskQueueEnqueue(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	q, _ := ec.Payload["question"].(string)
	return ec.Runtime.EnqueueAgentTaskQueue(ec.Context, agentID, strings.TrimSpace(q), payloadChatAtts(ec.Payload))
}

func handleAgentTaskQueueInterrupt(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	q, _ := ec.Payload["question"].(string)
	q = strings.TrimSpace(q)
	atts := payloadChatAtts(ec.Payload)
	// 与 agent.ask mode=interrupt 同路径：pause + 紧急 Ask
	if err := ec.Runtime.AskManagedBackground(ec.Context, agentID, q, atts, "interrupt"); err != nil {
		return nil, err
	}
	return map[string]any{"accepted": true, "agent_id": strconv.FormatInt(agentID, 10), "mode": "interrupt"}, nil
}

func handleAgentTaskQueueContinue(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	return ec.Runtime.ContinueAndRunAgentTaskQueue(ec.Context, agentID)
}

func handleAgentTaskQueueCancel(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	taskID, err := payloadTaskID(ec.Payload)
	if err != nil {
		return nil, err
	}
	if err := ec.Runtime.CancelAgentTaskQueue(ec.Context, agentID, taskID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "task_id": taskID}, nil
}

func handleAgentTaskQueueUpdate(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	taskID, err := payloadTaskID(ec.Payload)
	if err != nil {
		return nil, err
	}
	q, _ := ec.Payload["question"].(string)
	q = strings.TrimSpace(q)
	if q == "" {
		return nil, fmt.Errorf("question required")
	}
	if err := ec.Runtime.UpdateAgentTaskQueue(ec.Context, agentID, taskID, q); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "task_id": taskID}, nil
}

func handleAgentTaskQueueClearDone(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	if err := ec.Runtime.ClearAgentTaskQueueDone(ec.Context, agentID); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}
