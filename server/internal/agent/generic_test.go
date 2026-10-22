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

func TestCursorAssistDelta(t *testing.T) {
	if d := cursorAssistDelta("", "先想"); d != "先想" {
		t.Fatalf("empty prev: %q", d)
	}
	if d := cursorAssistDelta("先想", "先想一下"); d != "一下" {
		t.Fatalf("grow: %q", d)
	}
	if d := cursorAssistDelta("先想一下", "先想一下"); d != "" {
		t.Fatalf("same: %q", d)
	}
	if d := cursorAssistDelta("旧段", "新段"); d != "新段" {
		t.Fatalf("replace: %q", d)
	}
	if d := cursorAssistDelta("结论A", "过程说明\n结论A"); d != "" {
		t.Fatalf("swallow suffix should skip: %q", d)
	}
	if d := cursorAssistDelta("过程说明\n结论A", "结论A"); d != "" {
		t.Fatalf("already contained: %q", d)
	}
}

func TestCursorResultAppendNoDup(t *testing.T) {
	// 流式已是结论，result 带过程 + 同一结论 → 不补推
	if g := cursorResultAppend("已落地，热更新。", "先摸清结构。\n已落地，热更新。"); g != "" {
		t.Fatalf("suffix overlap: %q", g)
	}
	// 流式为空 → 整段
	if g := cursorResultAppend("", "最终结论"); g != "最终结论" {
		t.Fatalf("empty prev: %q", g)
	}
	// result 加长 → 只补尾巴
	if g := cursorResultAppend("你好", "你好世界"); g != "世界" {
		t.Fatalf("prefix grow: %q", g)
	}
	// 流式已含 result → 不补
	if g := cursorResultAppend("开场\n结论\n收尾", "结论"); g != "" {
		t.Fatalf("contained: %q", g)
	}
	// 真正新结论
	if g := cursorResultAppend("思考中…", "最终答案"); g != "\n最终答案" {
		t.Fatalf("new conclusion: %q", g)
	}
}
