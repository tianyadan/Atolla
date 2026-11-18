package agent

import (
	"encoding/json"
	"strings"
)

// AgentPhase 是各 CLI 运行事件统一后的阶段语义。
type AgentPhase string

const (
	PhaseThinking   AgentPhase = "thinking"
	PhaseWorking    AgentPhase = "working"
	PhaseResponding AgentPhase = "responding"
	PhaseWaiting    AgentPhase = "waiting"
	PhaseIdle       AgentPhase = "idle"
	PhaseError      AgentPhase = "error"
)

const (
	PhaseSourceExact   = "exact"
	PhaseSourceDerived = "derived"
)

// PhaseEvent 只表达运行阶段；工具明细继续由 Activity 负责。
type PhaseEvent struct {
	Phase  AgentPhase `json:"phase"`
	Engine string     `json:"engine,omitempty"`
	Source string     `json:"source"`
	Tool   string     `json:"tool,omitempty"`
}

// PhaseFn 接收统一后的运行阶段。
type PhaseFn func(PhaseEvent)

// ParseCursorPhase 把 Cursor Agent stream-json 事件转换为统一阶段。
func ParseCursorPhase(line []byte) (PhaseEvent, bool) {
	raw, ok := phaseJSON(line)
	if !ok {
		return PhaseEvent{}, false
	}
	typ := strField(raw, "type")
	subtype := strField(raw, "subtype")
	switch typ {
	case "thinking":
		if subtype == "delta" {
			return exactPhase("cursor", PhaseThinking, ""), true
		}
	case "tool_call":
		if subtype == "started" {
			tool, _ := raw["tool_call"].(map[string]interface{})
			return exactPhase("cursor", PhaseWorking, phaseToolName(tool)), true
		}
	case "assistant":
		return exactPhase("cursor", PhaseResponding, ""), true
	case "interaction_query":
		if subtype == "request" {
			return exactPhase("cursor", PhaseWaiting, ""), true
		}
	case "result":
		if failedPhaseResult(raw) {
			return exactPhase("cursor", PhaseError, ""), true
		}
		return exactPhase("cursor", PhaseIdle, ""), true
	case "error":
		return exactPhase("cursor", PhaseError, ""), true
	}
	return PhaseEvent{}, false
}

// ParseCodexPhase 把 codex exec --json 事件转换为统一阶段。
func ParseCodexPhase(line []byte) (PhaseEvent, bool) {
	raw, ok := phaseJSON(line)
	if !ok {
		return PhaseEvent{}, false
	}
	typ := strField(raw, "type")
	if typ == "turn.completed" {
		return exactPhase("codex", PhaseIdle, ""), true
	}
	if typ == "error" || typ == "turn.failed" {
		return exactPhase("codex", PhaseError, ""), true
	}
	if typ != "item.started" && typ != "item.completed" {
		return PhaseEvent{}, false
	}
	item, _ := raw["item"].(map[string]interface{})
	itemType := strField(item, "type")
	switch itemType {
	case "reasoning", "thought":
		return exactPhase("codex", PhaseThinking, ""), true
	case "agent_message":
		return exactPhase("codex", PhaseResponding, ""), true
	case "command_execution":
		if typ == "item.started" {
			return exactPhase("codex", PhaseWorking, "Bash"), true
		}
	case "file_change", "patch", "apply_patch":
		if typ == "item.started" {
			return exactPhase("codex", PhaseWorking, "Edit"), true
		}
	case "mcp_tool_call", "tool_call", "function_call", "web_search":
		if typ == "item.started" {
			return exactPhase("codex", PhaseWorking, phaseToolName(item)), true
		}
	case "error":
		return exactPhase("codex", PhaseError, ""), true
	}
	return PhaseEvent{}, false
}

// ParseClaudePhase 把 Claude stream-json partial message 转换为统一阶段。
func ParseClaudePhase(line []byte) (PhaseEvent, bool) {
	raw, ok := phaseJSON(line)
	if !ok {
		return PhaseEvent{}, false
	}
	typ := strField(raw, "type")
	switch typ {
	case "stream_event":
		ev, _ := raw["event"].(map[string]interface{})
		return parseClaudeStreamPhase(ev)
	case "content_block_start", "content_block_delta":
		return parseClaudeStreamPhase(raw)
	case "assistant":
		msg, _ := raw["message"].(map[string]interface{})
		return parseClaudeAssistantPhase(msg)
	case "result":
		if failedPhaseResult(raw) {
			return exactPhase("claude", PhaseError, ""), true
		}
		return exactPhase("claude", PhaseIdle, ""), true
	case "error":
		return exactPhase("claude", PhaseError, ""), true
	}
	return PhaseEvent{}, false
}

func parseClaudeStreamPhase(ev map[string]interface{}) (PhaseEvent, bool) {
	switch strField(ev, "type") {
	case "content_block_start":
		block, _ := ev["content_block"].(map[string]interface{})
		switch strField(block, "type") {
		case "thinking":
			return exactPhase("claude", PhaseThinking, ""), true
		case "text":
			return exactPhase("claude", PhaseResponding, ""), true
		case "tool_use":
			return exactPhase("claude", PhaseWorking, strField(block, "name")), true
		}
	case "content_block_delta":
		delta, _ := ev["delta"].(map[string]interface{})
		switch strField(delta, "type") {
		case "thinking_delta":
			return exactPhase("claude", PhaseThinking, ""), true
		case "text_delta":
			return exactPhase("claude", PhaseResponding, ""), true
		}
	}
	return PhaseEvent{}, false
}

func parseClaudeAssistantPhase(msg map[string]interface{}) (PhaseEvent, bool) {
	parts, _ := msg["content"].([]interface{})
	for i := len(parts) - 1; i >= 0; i-- {
		part, _ := parts[i].(map[string]interface{})
		switch strField(part, "type") {
		case "thinking":
			return exactPhase("claude", PhaseThinking, ""), true
		case "text":
			return exactPhase("claude", PhaseResponding, ""), true
		case "tool_use":
			return exactPhase("claude", PhaseWorking, strField(part, "name")), true
		}
	}
	return PhaseEvent{}, false
}

func phaseJSON(line []byte) (map[string]interface{}, bool) {
	var raw map[string]interface{}
	if json.Unmarshal(line, &raw) != nil {
		return nil, false
	}
	return raw, true
}

func exactPhase(engine string, phase AgentPhase, tool string) PhaseEvent {
	return PhaseEvent{Phase: phase, Engine: engine, Source: PhaseSourceExact, Tool: strings.TrimSpace(tool)}
}

func phaseToolName(m map[string]interface{}) string {
	for _, key := range []string{"name", "tool", "type"} {
		if value := strings.TrimSpace(strField(m, key)); value != "" {
			return value
		}
	}
	// Cursor 的 protobuf JSON 工具通常以 shellToolCall 等 case 名作为唯一键。
	if len(m) == 1 {
		for key := range m {
			return key
		}
	}
	return ""
}

func failedPhaseResult(raw map[string]interface{}) bool {
	if failed, _ := raw["is_error"].(bool); failed {
		return true
	}
	switch strings.ToLower(strField(raw, "subtype")) {
	case "error", "failed", "failure":
		return true
	default:
		return false
	}
}
