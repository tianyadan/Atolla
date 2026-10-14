package remotebridge

import (
	"fmt"
	"strconv"
	"strings"
)

// payloadAgentID reads agent_id from command payload (string or number).
func payloadAgentID(payload map[string]interface{}) (int64, error) {
	raw, _ := payload["agent_id"].(string)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		// JSON numbers often decode as float64
		switch n := payload["agent_id"].(type) {
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
		}
		return 0, fmt.Errorf("agent_id required")
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid agent_id")
	}
	return id, nil
}

// handleAgentAsk accepts and runs Ask in background (no SSE to phone).
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
	if q == "" {
		return nil, fmt.Errorf("question required")
	}
	if err := ec.Runtime.AskManagedBackground(ec.Context, agentID, q); err != nil {
		return nil, err
	}
	return map[string]any{"accepted": true, "agent_id": strconv.FormatInt(agentID, 10)}, nil
}

// handleAgentStop stops in-flight Ask for one agent.
func handleAgentStop(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	ok := ec.Runtime.StopManaged(agentID)
	return map[string]any{"stopped": ok, "agent_id": strconv.FormatInt(agentID, 10)}, nil
}

// handleAgentSetTaskPlan persists task_plan_enabled on the managed agent.
func handleAgentSetTaskPlan(ec *ExecContext) (any, error) {
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	enabled, ok := ec.Payload["enabled"].(bool)
	if !ok {
		return nil, fmt.Errorf("enabled boolean required")
	}
	if err := ec.Store.SetManagedAgentTaskPlan(ec.Context, agentID, enabled); err != nil {
		return nil, err
	}
	_ = pushAgentsAfterPolicy(ec)
	return map[string]any{
		"agent_id": strconv.FormatInt(agentID, 10),
		"enabled":  enabled,
	}, nil
}

// handleAgentSetAutoReview toggles AI auto-review via runtime.
func handleAgentSetAutoReview(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	enabled, ok := ec.Payload["enabled"].(bool)
	if !ok {
		return nil, fmt.Errorf("enabled boolean required")
	}
	if err := ec.Runtime.SetAutoReview(ec.Context, agentID, enabled); err != nil {
		return nil, err
	}
	_ = pushAgentsAfterPolicy(ec)
	return map[string]any{
		"agent_id": strconv.FormatInt(agentID, 10),
		"enabled":  enabled,
	}, nil
}

// handleAgentSetAutoApproveAll toggles approve-all policy via runtime.
func handleAgentSetAutoApproveAll(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	enabled, ok := ec.Payload["enabled"].(bool)
	if !ok {
		return nil, fmt.Errorf("enabled boolean required")
	}
	if err := ec.Runtime.SetAutoApproveAll(ec.Context, agentID, enabled); err != nil {
		return nil, err
	}
	_ = pushAgentsAfterPolicy(ec)
	return map[string]any{
		"agent_id": strconv.FormatInt(agentID, 10),
		"enabled":  enabled,
	}, nil
}

// handlePermissionDecide resolves a pending Hub permission from the phone.
func handlePermissionDecide(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	requestID, _ := ec.Payload["request_id"].(string)
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil, fmt.Errorf("request_id required")
	}
	behavior, _ := ec.Payload["behavior"].(string)
	behavior = strings.TrimSpace(behavior)
	if behavior == "" {
		return nil, fmt.Errorf("behavior required")
	}
	err := ec.Runtime.DecidePermission(requestID, behavior)
	// 无论成功或已裁决：都尽量清掉中继镜像，避免手机一直弹同一张卡
	if ec.Client != nil {
		_ = ec.Client.PostPermissionsResolved(ec.Context, []string{requestID})
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "request_id": requestID, "behavior": behavior}, nil
}

// pushAgentsAfterPolicy refreshes agents mirror so phone sees new flags.
func pushAgentsAfterPolicy(ec *ExecContext) error {
	if ec.Client == nil || ec.Store == nil {
		return nil
	}
	return PushAgentsTasksSnapshots(ec)
}
