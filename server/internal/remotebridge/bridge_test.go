package remotebridge

import (
	"testing"
)

func TestHandlersRejectUnknownAction(t *testing.T) {
	if _, ok := Handlers["unknown.action"]; ok {
		t.Fatal("unknown.action must not be registered")
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
	if len(RegisteredActions()) != 29 {
		t.Fatalf("expected 29 V1 actions, got %d", len(RegisteredActions()))
	}
}
