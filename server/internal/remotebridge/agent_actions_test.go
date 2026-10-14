package remotebridge

import (
	"context"
	"testing"
)

type stubRuntime struct {
	asked      bool
	agent      int64
	q          string
	stopOK     bool
	autoReview *bool
	approveAll *bool
	decideID   string
	decideBeh  string
}

func (s *stubRuntime) AskManagedBackground(_ context.Context, agentID int64, question string) error {
	s.asked = true
	s.agent = agentID
	s.q = question
	return nil
}

func (s *stubRuntime) StopManaged(agentID int64) bool {
	s.agent = agentID
	return s.stopOK
}

func (s *stubRuntime) SetAutoReview(_ context.Context, agentID int64, enabled bool) error {
	s.agent = agentID
	s.autoReview = &enabled
	return nil
}

func (s *stubRuntime) SetAutoApproveAll(_ context.Context, agentID int64, enabled bool) error {
	s.agent = agentID
	s.approveAll = &enabled
	return nil
}

func (s *stubRuntime) DecidePermission(requestID, behavior string) error {
	s.decideID = requestID
	s.decideBeh = behavior
	return nil
}

func TestHandleAgentAskAccepts(t *testing.T) {
	rt := &stubRuntime{}
	ec := &ExecContext{
		Context: context.Background(),
		Payload: map[string]interface{}{"agent_id": "42", "question": "hello"},
		Runtime: rt,
	}
	body, err := handleAgentAsk(ec)
	if err != nil {
		t.Fatal(err)
	}
	m := body.(map[string]any)
	if m["accepted"] != true || !rt.asked || rt.agent != 42 || rt.q != "hello" {
		t.Fatalf("unexpected: body=%v rt=%+v", body, rt)
	}
}

func TestHandleAgentAskRequiresRuntime(t *testing.T) {
	_, err := handleAgentAsk(&ExecContext{
		Payload: map[string]interface{}{"agent_id": "1", "question": "x"},
	})
	if err == nil {
		t.Fatal("expected error without runtime")
	}
}

func TestHandleAgentStop(t *testing.T) {
	rt := &stubRuntime{stopOK: true}
	body, err := handleAgentStop(&ExecContext{
		Payload: map[string]interface{}{"agent_id": float64(7)},
		Runtime: rt,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := body.(map[string]any)
	if m["stopped"] != true || rt.agent != 7 {
		t.Fatalf("unexpected: %v", body)
	}
}

func TestHandleAgentSetAutoReview(t *testing.T) {
	rt := &stubRuntime{}
	body, err := handleAgentSetAutoReview(&ExecContext{
		Context: context.Background(),
		Payload: map[string]interface{}{"agent_id": "3", "enabled": true},
		Runtime: rt,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := body.(map[string]any)
	if m["enabled"] != true || rt.agent != 3 || rt.autoReview == nil || !*rt.autoReview {
		t.Fatalf("unexpected: %v rt=%+v", body, rt)
	}
}

func TestHandleAgentSetAutoApproveAll(t *testing.T) {
	rt := &stubRuntime{}
	_, err := handleAgentSetAutoApproveAll(&ExecContext{
		Context: context.Background(),
		Payload: map[string]interface{}{"agent_id": "4", "enabled": false},
		Runtime: rt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rt.approveAll == nil || *rt.approveAll {
		t.Fatalf("expected false, got %+v", rt.approveAll)
	}
}

func TestHandlePermissionDecide(t *testing.T) {
	rt := &stubRuntime{}
	body, err := handlePermissionDecide(&ExecContext{
		Payload: map[string]interface{}{"request_id": "abc", "behavior": "allow_session"},
		Runtime: rt,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := body.(map[string]any)
	if m["ok"] != true || rt.decideID != "abc" || rt.decideBeh != "allow_session" {
		t.Fatalf("unexpected: %v rt=%+v", body, rt)
	}
}
