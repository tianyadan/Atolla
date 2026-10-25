package agent

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestShortEngineErrorStdinBanner(t *testing.T) {
	raw := "codex: Reading additional input from stdin...\nOpenAI version v0.158.0\nworkdir: /tmp\nmodel: gpt-5.5\n【系统规则】\n一大段权限说明…"
	got := ShortEngineError(raw)
	if got != "CLI 异常：等待 stdin 输入失败，请重试" {
		t.Fatalf("got %q", got)
	}
}

func TestShortEngineErrorKeepsTwoShortLines(t *testing.T) {
	raw := "codex: auth failed\nplease run: codex login\nworkdir: /x"
	got := ShortEngineError(raw)
	if got != "codex: auth failed · please run: codex login" {
		t.Fatalf("got %q", got)
	}
}

func TestShortEngineErrorClipsLongLine(t *testing.T) {
	long := strings.Repeat("x", 300)
	got := ShortEngineError("codex: " + long)
	if utf8.RuneCountInString(got) > 121 {
		t.Fatalf("too long: %d %q", utf8.RuneCountInString(got), got)
	}
}
