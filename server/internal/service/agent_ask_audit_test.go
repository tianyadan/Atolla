package service

import (
	"context"
	"errors"
	"testing"

	"atolla/server/internal/store"
)

func TestMapAgentAskStatus(t *testing.T) {
	st, _, _ := mapAgentAskStatus(context.Canceled, nil, nil)
	if st != store.AgentAskStatusCancelled {
		t.Fatalf("cancel -> %s", st)
	}
	st, _, _ = mapAgentAskStatus(nil, errors.New("request timeout"), nil)
	if st != store.AgentAskStatusTimeout {
		t.Fatalf("timeout -> %s", st)
	}
	st, _, _ = mapAgentAskStatus(nil, errors.New("boom"), nil)
	if st != store.AgentAskStatusFailed {
		t.Fatalf("fail -> %s", st)
	}
	st, _, _ = mapAgentAskStatus(nil, nil, &store.Message{Status: "ok"})
	if st != store.AgentAskStatusCompleted {
		t.Fatalf("ok -> %s", st)
	}
}
