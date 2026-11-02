package service

import (
	"strings"
	"testing"
)

func TestLLMTraceSourceDoesNotInventModelProviderData(t *testing.T) {
	cases := map[string]string{
		"claude": "Claude Stream",
		"codex":  "Codex JSONL",
		"cursor": "Cursor Stream",
		"agent":  "Cursor Stream",
		"custom": "Atolla Derived",
	}
	for engine, want := range cases {
		if got := llmTraceSource(engine); got != want {
			t.Fatalf("source(%s)=%q want %q", engine, got, want)
		}
	}
}

func TestLLMTraceInputMarksPlatformVisibilityAndUnavailableFields(t *testing.T) {
	got := llmTraceInputContent("system text", "user text", "history text", nil)
	for _, want := range []string{"平台可见输入", "system text", "user text", "history text", "厂商最终请求体"} {
		if !strings.Contains(got, want) {
			t.Fatalf("trace input missing %q: %s", want, got)
		}
	}
}
