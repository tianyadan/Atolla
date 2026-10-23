package service

import (
	"context"
	"testing"
	"time"

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
