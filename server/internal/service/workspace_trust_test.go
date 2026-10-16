package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"atolla/server/internal/permission"
)

func TestConfirmCursorWorkspaceTrustAllow(t *testing.T) {
	s := &Service{Perms: permission.NewHub(5), trustedDirs: map[string]struct{}{}}
	errCh := make(chan error, 1)
	go func() {
		ok, reason := s.confirmCursorWorkspaceTrust(context.Background(), 0, "/tmp/code_work_space")
		if !ok {
			errCh <- fmt.Errorf("expected allow, got %s", reason)
			return
		}
		errCh <- nil
	}()
	var id string
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		items := s.Perms.Pending(0)
		if len(items) > 0 && items[0].ToolName == "WorkspaceTrust" {
			id = items[0].ID
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("workspace trust card was not registered")
	}
	if err := s.Perms.Decide(id, permission.Allow, "user", false); err != nil {
		t.Fatal(err)
	}
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
}

func TestConfirmCursorWorkspaceTrustDeny(t *testing.T) {
	s := &Service{Perms: permission.NewHub(5), trustedDirs: map[string]struct{}{}}
	done := make(chan struct{})
	var ok bool
	go func() {
		ok, _ = s.confirmCursorWorkspaceTrust(context.Background(), 0, "/tmp/code_work_space")
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	var id string
	for time.Now().Before(deadline) {
		items := s.Perms.Pending(0)
		if len(items) > 0 {
			id = items[0].ID
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("workspace trust card was not registered")
	}
	if err := s.Perms.Decide(id, permission.Deny, "user", false); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("confirm did not return")
	}
	if ok {
		t.Fatal("deny should not trust workspace")
	}
	if s.workspaceTrusted("/tmp/code_work_space") {
		t.Fatal("denied directory must not be remembered")
	}
}
