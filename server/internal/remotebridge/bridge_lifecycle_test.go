package remotebridge

import (
	"context"
	"testing"
	"time"

	"atolla/server/internal/store"
)

// TestBridgeStopOnParentCancel ensures the run loop exits when the parent context is cancelled.
func TestBridgeStopOnParentCancel(t *testing.T) {
	dir := t.TempDir()
	cs, err := NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = cs.Update(Config{
		Enabled:     true,
		BaseURL:     "http://127.0.0.1:1",
		InstanceID:  "test-bridge",
		DisplayName: "test",
		Password:    "Ab12cd",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !cs.Ready() {
		t.Fatal("expected ready config")
	}

	parent, cancel := context.WithCancel(context.Background())
	b := NewBridge(cs, &store.Store{})
	b.Start(parent)

	deadline := time.After(3 * time.Second)
	for {
		if b.StatusSnapshot().Running {
			break
		}
		select {
		case <-deadline:
			t.Fatal("bridge did not enter running state")
		case <-time.After(10 * time.Millisecond):
		}
	}

	cancel()
	b.Stop()

	deadline = time.After(3 * time.Second)
	for b.StatusSnapshot().Running {
		select {
		case <-deadline:
			t.Fatal("bridge still running after cancel/stop")
		case <-time.After(10 * time.Millisecond):
		}
	}
}
