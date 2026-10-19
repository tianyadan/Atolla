package remotebridge

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"atolla/server/internal/store"
)

// TestBridgeReloadKeepsRunning ensures a stale run loop cannot clear status after Reload.
func TestBridgeReloadKeepsRunning(t *testing.T) {
	var longPollBlocked atomic.Bool
	longPollBlocked.Store(true)
	var registerCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/device/register":
			registerCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/api/device/commands/long-poll":
			for longPollBlocked.Load() {
				time.Sleep(5 * time.Millisecond)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"commands":[]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	cs, err := NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = cs.Update(Config{
		Enabled:     true,
		BaseURL:     srv.URL,
		InstanceID:  "reload-bridge-test",
		DisplayName: "reload",
		Password:    "Ab12Cd",
	})
	if err != nil {
		t.Fatal(err)
	}

	parent, cancel := context.WithCancel(context.Background())
	defer cancel()

	b := NewBridge(cs, &store.Store{})
	b.Start(parent)

	waitUntil(t, 3*time.Second, func() bool {
		st := b.StatusSnapshot()
		return st.Running && st.Registered
	})

	b.Reload(parent)

	waitUntil(t, 3*time.Second, func() bool {
		st := b.StatusSnapshot()
		return st.Running && st.Registered
	})

	longPollBlocked.Store(false)

	waitUntil(t, 5*time.Second, func() bool {
		st := b.StatusSnapshot()
		return st.Running && st.Registered
	})

	if registerCount.Load() < 2 {
		t.Fatalf("expected at least 2 register calls after reload, got %d", registerCount.Load())
	}

	beforeSkip := registerCount.Load()
	b.ReloadWithoutRegister(parent)
	time.Sleep(200 * time.Millisecond)
	if got := registerCount.Load(); got != beforeSkip {
		t.Fatalf("reload without register called register: before %d after %d", beforeSkip, got)
	}

	b.Stop()
}

func waitUntil(t *testing.T, timeout time.Duration, ok func() bool) {
	t.Helper()
	deadline := time.After(timeout)
	for !ok() {
		select {
		case <-deadline:
			t.Fatal("condition not met before timeout")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// TestDefaultInstanceIDIsUUIDShape ensures new bridge configs do not use hostname ids.
func TestDefaultInstanceIDIsUUIDShape(t *testing.T) {
	dir := t.TempDir()
	cs, err := NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	id := cs.Public().InstanceID
	if len(id) < 32 {
		t.Fatalf("expected UUID-like instance id, got %q", id)
	}
}
