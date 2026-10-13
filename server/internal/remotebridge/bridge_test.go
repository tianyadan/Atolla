package remotebridge

import (
	"testing"
)

func TestHandlersRejectUnregisteredActions(t *testing.T) {
	unregistered := []string{"agent.ask", "agent.stop", "unknown.action"}
	for _, action := range unregistered {
		if _, ok := Handlers[action]; ok {
			t.Fatalf("action %q must not be registered", action)
		}
	}
}

func TestRegisteredActionsMatchHandlers(t *testing.T) {
	for _, action := range RegisteredActions() {
		if _, ok := Handlers[action]; !ok {
			t.Fatalf("RegisteredActions lists %q but Handlers missing", action)
		}
	}
}

func TestRegisteredActionsCount(t *testing.T) {
	if len(RegisteredActions()) != 4 {
		t.Fatalf("expected 4 V1 actions, got %d", len(RegisteredActions()))
	}
}
