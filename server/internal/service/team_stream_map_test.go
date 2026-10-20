package service

import (
	"testing"

	"atolla/server/internal/teamstream"
)

// TestTeamHubReplayContract 再确认 hub 补发契约（服务层依赖同一实现）。
func TestTeamHubReplayContract(t *testing.T) {
	h := teamstream.NewHub(4)
	h.Publish(1, "agent.status", map[string]any{"agentId": "1"})
	h.Publish(1, "task.progress", map[string]any{"agentId": "1", "progress": 10})
	evs, ok := h.ReplayAfter(1, 1)
	if !ok || len(evs) != 1 || evs[0].Payload["type"] != "task.progress" {
		t.Fatalf("replay: ok=%v n=%d", ok, len(evs))
	}
}
