package service

import (
	"context"
	"testing"
	"time"

	"atolla/server/internal/remotebridge"
	"atolla/server/internal/store"
)

// TestStopRemoteBridgeStopsLoop verifies service shutdown cancels the bridge parent context.
func TestStopRemoteBridgeStopsLoop(t *testing.T) {
	dir := t.TempDir()
	cs, err := remotebridge.NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = cs.Update(remotebridge.Config{
		Enabled:     true,
		BaseURL:     "http://127.0.0.1:1",
		InstanceID:  "svc-test",
		DisplayName: "svc",
		Password:    "Xy9z01",
	})
	if err != nil {
		t.Fatal(err)
	}

	s := &Service{}
	s.remoteBridgeParent, s.remoteBridgeCancel = context.WithCancel(context.Background())
	s.RemoteBridge = remotebridge.NewBridge(cs, &store.Store{})
	s.RemoteBridge.Start(s.remoteBridgeParent)

	waitBridgeRunning(t, s.RemoteBridge, true)
	s.StopRemoteBridge()
	waitBridgeRunning(t, s.RemoteBridge, false)
}

func waitBridgeRunning(t *testing.T, b *remotebridge.Bridge, want bool) {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for b.StatusSnapshot().Running != want {
		select {
		case <-deadline:
			t.Fatalf("running=%v want=%v", b.StatusSnapshot().Running, want)
		case <-time.After(10 * time.Millisecond):
		}
	}
}
