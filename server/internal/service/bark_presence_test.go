package service

import (
	"context"
	"testing"
	"time"

	"atolla/server/config"
	"atolla/server/internal/remotebridge"
	"atolla/server/internal/store"
)

func TestPCViewerMarksChatOpen(t *testing.T) {
	s := &Service{}
	if s.agentChatOpen(3) {
		t.Fatal("empty")
	}
	s.SetPCViewer(3)
	if !s.agentChatOpen(3) {
		t.Fatal("want open")
	}
	if s.agentChatOpen(4) {
		t.Fatal("other agent")
	}
	s.ClearPCViewer()
	if s.agentChatOpen(3) {
		t.Fatal("cleared")
	}
	s.SetPCViewer(3)
	s.pcViewMu.Lock()
	s.pcViewAt = time.Now().Add(-pcViewerTTL - time.Second)
	s.pcViewMu.Unlock()
	if s.agentChatOpen(3) {
		t.Fatal("expired heartbeat should not count as viewing")
	}
}

func TestNotifyAgentTerminalNoPanicWhenViewing(t *testing.T) {
	s := &Service{}
	s.SetPCViewer(9)
	// Store 为空时只跳过清未读，不应 panic
	s.notifyAgentTerminal(context.Background(), 9)
	s.ClearPCViewer()
	s.notifyAgentTerminal(context.Background(), 9)
}

func TestBarkKindAllowed(t *testing.T) {
	off := store.NotifyPrefs{}
	on := store.NotifyPrefs{TaskDone: true, Permission: true}
	if barkKindAllowed(off, "perm:1") || barkKindAllowed(off, "done:2") {
		t.Fatal("both off")
	}
	if !barkKindAllowed(on, "perm:1") || !barkKindAllowed(on, "done:2") {
		t.Fatal("both on")
	}
	onlyDone := store.NotifyPrefs{TaskDone: true}
	if barkKindAllowed(onlyDone, "perm:1") || !barkKindAllowed(onlyDone, "done:2") {
		t.Fatal("task done only")
	}
}

func TestBarkAppIconURLPrefersExplicitConfig(t *testing.T) {
	bridge := testBarkRemoteBridge(t, "https://relay.example/", "mac office")
	s := &Service{
		Cfg:          config.Config{BarkIconURL: " https://cdn.example/atolla.png "},
		RemoteBridge: bridge,
	}
	if got := s.barkAppIconURL(); got != "https://cdn.example/atolla.png" {
		t.Fatalf("icon=%q", got)
	}

	s.Cfg.BarkIconURL = ""
	if got := s.barkAppIconURL(); got != "https://relay.example/app-icon-1024.png" {
		t.Fatalf("fallback icon=%q", got)
	}
}

func TestBarkDeepLinkEscapesSegments(t *testing.T) {
	s := &Service{RemoteBridge: testBarkRemoteBridge(t, "https://relay.example", "mac office/a")}
	if got := s.barkDeepLink("agent", 37, ""); got != "atolla://agent/mac%20office%2Fa/37/chat" {
		t.Fatalf("agent link=%q", got)
	}
	if got := s.barkDeepLink("approval", 37, "req/1"); got != "atolla://approval/mac%20office%2Fa/37/req%2F1" {
		t.Fatalf("approval link=%q", got)
	}
}

func testBarkRemoteBridge(t *testing.T, baseURL, instanceID string) *remotebridge.Bridge {
	t.Helper()
	cs, err := remotebridge.NewConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("new relay config: %v", err)
	}
	if _, err := cs.Update(remotebridge.Config{BaseURL: baseURL, InstanceID: instanceID}); err != nil {
		t.Fatalf("update relay config: %v", err)
	}
	return &remotebridge.Bridge{Config: cs}
}
