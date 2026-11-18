package service

import (
	"errors"
	"testing"

	"atolla/server/internal/agent"
)

func TestPhaseFromSinkEmitsAgentPhasePayload(t *testing.T) {
	var got map[string]any
	fn := phaseFromSink(func(ev map[string]any) { got = ev }, 42)
	fn(agent.PhaseEvent{
		Phase: agent.PhaseThinking, Engine: "cursor", Source: agent.PhaseSourceExact, Tool: "Shell",
	})
	if got["type"] != "agent_phase" || got["agent_id"] != int64(42) || got["phase"] != "thinking" {
		t.Fatalf("unexpected payload: %#v", got)
	}
	if got["engine"] != "cursor" || got["source"] != "exact" || got["tool"] != "Shell" {
		t.Fatalf("missing phase metadata: %#v", got)
	}
}

func TestFinalAgentPhaseDoesNotOverwriteExactTerminalEvent(t *testing.T) {
	if _, ok := finalAgentPhase(agent.PhaseError, nil); ok {
		t.Fatal("exact error must not be overwritten by derived idle")
	}
	if _, ok := finalAgentPhase(agent.PhaseIdle, nil); ok {
		t.Fatal("exact idle must not be emitted twice")
	}
	if got, ok := finalAgentPhase(agent.PhaseWorking, nil); !ok || got != agent.PhaseIdle {
		t.Fatalf("unfinished success=(%q,%v), want derived idle", got, ok)
	}
	if got, ok := finalAgentPhase(agent.PhaseWorking, errors.New("failed")); !ok || got != agent.PhaseError {
		t.Fatalf("failed run=(%q,%v), want derived error", got, ok)
	}
}
