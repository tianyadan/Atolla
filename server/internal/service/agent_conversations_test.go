package service

import "testing"

func TestAgentConversationStatusBusy(t *testing.T) {
	for _, status := range []string{"running", "busy", "waiting", "插话中", "initializing", "compressing"} {
		if !AgentConversationStatusBusy(status) {
			t.Fatalf("status %q should block switching", status)
		}
	}
	for _, status := range []string{"", "idle", "error", "completed"} {
		if AgentConversationStatusBusy(status) {
			t.Fatalf("status %q should allow switching", status)
		}
	}
}
