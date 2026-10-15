package remotebridge

import (
	"testing"
	"time"
)

type stubViewer struct {
	id    int64
	cleared bool
}

func (s *stubViewer) SetMobileViewer(agentID int64) { s.id = agentID; s.cleared = false }
func (s *stubViewer) ClearMobileViewer()            { s.id = 0; s.cleared = true }
func (s *stubViewer) MobileViewingAgentID() (int64, bool) {
	if s.id <= 0 {
		return 0, false
	}
	return s.id, true
}

func TestHandleViewerSetAndClear(t *testing.T) {
	v := &stubViewer{}
	body, err := handleViewerSet(&ExecContext{
		Payload: map[string]interface{}{"agent_id": "15"},
		Viewer:  v,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := body.(map[string]any)
	if m["ok"] != true || v.id != 15 {
		t.Fatalf("set: body=%v viewer=%+v", body, v)
	}

	body, err = handleViewerClear(&ExecContext{Viewer: v})
	if err != nil {
		t.Fatal(err)
	}
	if !v.cleared || v.id != 0 {
		t.Fatalf("clear: viewer=%+v", v)
	}
	_ = body
}

func TestBridgeMobileViewerTTL(t *testing.T) {
	b := &Bridge{}
	b.SetMobileViewer(9)
	id, ok := b.MobileViewingAgentID()
	if !ok || id != 9 {
		t.Fatalf("want 9, got %d ok=%v", id, ok)
	}
	b.mu.Lock()
	b.mobileViewerAt = time.Now().Add(-2 * mobileViewerTTL)
	b.mu.Unlock()
	if _, ok := b.MobileViewingAgentID(); ok {
		t.Fatal("expected expired viewer")
	}
	b.ClearMobileViewer()
	if _, ok := b.MobileViewingAgentID(); ok {
		t.Fatal("expected cleared")
	}
}
