package agent

import (
	"strings"
	"testing"
)

func TestParseCursorPrintOutput(t *testing.T) {
	raw := `{"type":"result","subtype":"success","result":"hello","session_id":"abc-123","usage":{"inputTokens":10,"outputTokens":2,"cacheReadTokens":1}}`
	text, meta := ParseCursorPrintOutput(raw)
	if text != "hello" {
		t.Fatalf("text=%q", text)
	}
	if meta.SessionID != "abc-123" {
		t.Fatalf("session=%q", meta.SessionID)
	}
	if meta.InputTokens != 10 || meta.OutputTokens != 2 || meta.CacheRead != 1 {
		t.Fatalf("meta=%+v", meta)
	}
}

func TestParseCursorPrintOutputSessionIdCamel(t *testing.T) {
	raw := `{"result":"ok","sessionId":"chat-xyz"}`
	_, meta := ParseCursorPrintOutput(raw)
	if meta.SessionID != "chat-xyz" {
		t.Fatalf("session=%q", meta.SessionID)
	}
}

func TestCursorCLIArgsTrust(t *testing.T) {
	args := CursorCLIArgs("hi", "sess", "json", true)
	if len(args) < 2 || args[0] != "--trust" {
		t.Fatalf("args=%v", args)
	}
	joined := strings.Join(args, " ")
	if strings.Contains(joined, "--yolo") || strings.Contains(joined, " -f") {
		t.Fatalf("must not skip all approvals: %v", args)
	}
	plain := CursorCLIArgs("hi", "", "json", false)
	if plain[0] == "--trust" {
		t.Fatalf("untrusted args=%v", plain)
	}
}

func TestIsCursorWorkspaceTrustRequired(t *testing.T) {
	msg := "agent: ⚠ Workspace Trust Required\nPass --trust"
	if !IsCursorWorkspaceTrustRequired(msg) {
		t.Fatal("expected trust required")
	}
	if IsCursorWorkspaceTrustRequired("exit status 1") {
		t.Fatal("unrelated error")
	}
}

func TestParseCursorPrintOutputPlain(t *testing.T) {
	text, meta := ParseCursorPrintOutput("just plain")
	if text != "just plain" || meta.SessionID != "" {
		t.Fatalf("text=%q meta=%+v", text, meta)
	}
}
