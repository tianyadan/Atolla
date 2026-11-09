package remotebridge

import (
	"context"
	"encoding/base64"
	"testing"
)

type githubIdeaStubRuntime struct {
	stubRuntime
	deliveryID string
	event      string
	signature  string
	body       string
}

func (s *githubIdeaStubRuntime) HandleGitHubIdeaEvent(_ context.Context, deliveryID, event, signature string, body []byte) (any, error) {
	s.deliveryID = deliveryID
	s.event = event
	s.signature = signature
	s.body = string(body)
	return map[string]any{"dispatched": 1}, nil
}

func TestHandleGitHubIdeaEventPreservesRawBody(t *testing.T) {
	runtime := &githubIdeaStubRuntime{}
	raw := []byte(`{"action":"opened","body":"中文"}`)
	out, err := handleGitHubIdeaEvent(&ExecContext{
		Context: context.Background(),
		Runtime: runtime,
		Payload: map[string]any{
			"delivery_id": "delivery-1",
			"event":       "pull_request",
			"signature":   "sha256=abc",
			"body_base64": base64.StdEncoding.EncodeToString(raw),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.body != string(raw) || runtime.deliveryID != "delivery-1" || runtime.event != "pull_request" {
		t.Fatalf("unexpected runtime input: %+v", runtime)
	}
	if out.(map[string]any)["dispatched"] != 1 {
		t.Fatalf("unexpected output: %v", out)
	}
}
