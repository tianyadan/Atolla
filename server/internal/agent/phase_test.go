package agent

import "testing"

func TestParseCursorPhaseUsesExactStreamEvents(t *testing.T) {
	tests := []struct {
		name  string
		line  string
		phase AgentPhase
		tool  string
		ok    bool
	}{
		{"thinking delta", `{"type":"thinking","subtype":"delta","text":"分析"}`, PhaseThinking, "", true},
		{"thinking completed waits for next event", `{"type":"thinking","subtype":"completed"}`, "", "", false},
		{"tool started", `{"type":"tool_call","subtype":"started","tool_call":{"name":"Shell"}}`, PhaseWorking, "Shell", true},
		{"tool completed waits for next event", `{"type":"tool_call","subtype":"completed"}`, "", "", false},
		{"assistant", `{"type":"assistant","message":{"content":[{"type":"text","text":"完成"}]}}`, PhaseResponding, "", true},
		{"interaction request", `{"type":"interaction_query","subtype":"request"}`, PhaseWaiting, "", true},
		{"result", `{"type":"result","result":"完成"}`, PhaseIdle, "", true},
		{"failed result", `{"type":"result","subtype":"error","is_error":true}`, PhaseError, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseCursorPhase([]byte(tt.line))
			if ok != tt.ok || got.Phase != tt.phase || got.Tool != tt.tool || (ok && got.Source != PhaseSourceExact) {
				t.Fatalf("ParseCursorPhase()=(%+v,%v), want phase=%q tool=%q ok=%v exact", got, ok, tt.phase, tt.tool, tt.ok)
			}
		})
	}
}

func TestParseCodexPhaseTracksReasoningToolsAndMessages(t *testing.T) {
	tests := []struct {
		name  string
		line  string
		phase AgentPhase
		tool  string
		ok    bool
	}{
		{"reasoning", `{"type":"item.started","item":{"type":"reasoning"}}`, PhaseThinking, "", true},
		{"command", `{"type":"item.started","item":{"type":"command_execution","command":"pwd"}}`, PhaseWorking, "Bash", true},
		{"tool", `{"type":"item.started","item":{"type":"mcp_tool_call","name":"filesystem"}}`, PhaseWorking, "filesystem", true},
		{"tool completion waits", `{"type":"item.completed","item":{"type":"mcp_tool_call","name":"filesystem"}}`, "", "", false},
		{"message", `{"type":"item.completed","item":{"type":"agent_message","text":"完成"}}`, PhaseResponding, "", true},
		{"turn completed", `{"type":"turn.completed","usage":{}}`, PhaseIdle, "", true},
		{"error", `{"type":"error","message":"failed"}`, PhaseError, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseCodexPhase([]byte(tt.line))
			if ok != tt.ok || got.Phase != tt.phase || got.Tool != tt.tool || (ok && got.Source != PhaseSourceExact) {
				t.Fatalf("ParseCodexPhase()=(%+v,%v), want phase=%q tool=%q ok=%v exact", got, ok, tt.phase, tt.tool, tt.ok)
			}
		})
	}
}

func TestParseClaudePhaseUsesPartialMessageEvents(t *testing.T) {
	tests := []struct {
		name  string
		line  string
		phase AgentPhase
		tool  string
		ok    bool
	}{
		{"thinking delta", `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"分析"}}}`, PhaseThinking, "", true},
		{"text delta", `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"回答"}}}`, PhaseResponding, "", true},
		{"tool start", `{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"Read"}}}`, PhaseWorking, "Read", true},
		{"block stop waits", `{"type":"stream_event","event":{"type":"content_block_stop","index":1}}`, "", "", false},
		{"result", `{"type":"result","result":"完成"}`, PhaseIdle, "", true},
		{"failed result", `{"type":"result","is_error":true}`, PhaseError, "", true},
		{"error", `{"type":"error","error":{"message":"failed"}}`, PhaseError, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseClaudePhase([]byte(tt.line))
			if ok != tt.ok || got.Phase != tt.phase || got.Tool != tt.tool || (ok && got.Source != PhaseSourceExact) {
				t.Fatalf("ParseClaudePhase()=(%+v,%v), want phase=%q tool=%q ok=%v exact", got, ok, tt.phase, tt.tool, tt.ok)
			}
		})
	}
}
