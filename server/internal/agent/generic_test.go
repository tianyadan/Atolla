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

func TestCursorAnswerKeepsResultWhenCLIJSONParseFails(t *testing.T) {
	raw := strings.Join([]string{
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"先说一半"}]},"session_id":"s1"}`,
		`{"type":"result","subtype":"success","result":"任务已经做完","session_id":"s1","usage":{"inputTokens":3,"outputTokens":1}}`,
		`SyntaxError: Expected double-quoted property name in JSON at position 1378 (line 1 column 1379)`,
	}, "\n")
	text, meta, ok := cursorAnswer(raw)
	if !ok {
		t.Fatal("expected recovered answer")
	}
	if text != "任务已经做完" {
		t.Fatalf("text=%q", text)
	}
	if meta.SessionID != "s1" || meta.InputTokens != 3 || meta.OutputTokens != 1 {
		t.Fatalf("meta=%+v", meta)
	}
}

func TestCursorAnswerIgnoresPlainSyntaxError(t *testing.T) {
	_, _, ok := cursorAnswer("SyntaxError: Expected double-quoted property name in JSON at position 1378 (line 1 column 1379)")
	if ok {
		t.Fatal("noise alone is not an answer")
	}
}

func TestCursorCLIArgsStreamJSON(t *testing.T) {
	args := CursorCLIArgs("hi", "", "stream-json", false)
	if !strings.Contains(strings.Join(args, " "), "--output-format stream-json") {
		t.Fatalf("args=%v", args)
	}
}

func TestParseCursorPrintOutputPlain(t *testing.T) {
	text, meta := ParseCursorPrintOutput("just plain")
	if text != "just plain" || meta.SessionID != "" {
		t.Fatalf("text=%q meta=%+v", text, meta)
	}
}
