package agent

import (
	"strings"
	"unicode/utf8"
)

// ShortEngineError 将引擎 stderr / Error() 压成 1～2 行短文案，
// 避免 Codex 把 banner、配置墙或整段 prompt 刷进「上次错误」。
func ShortEngineError(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return "未知错误"
	}

	// 去掉重复引擎前缀，最后统一加回（由调用方决定是否加）
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "reading additional input from stdin") {
		return "CLI 异常：等待 stdin 输入失败，请重试"
	}
	if strings.Contains(lower, "no rollout found") {
		return "会话已失效（no rollout），将自动重建后重试"
	}
	if strings.Contains(lower, "argument list too long") {
		return "提示词过长，系统参数超限"
	}

	var picked []string
	for _, raw := range strings.Split(msg, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		// 碰到 prompt / 系统规则墙即停，后面都是噪声
		if isEngineErrorNoiseLine(line) {
			if len(picked) == 0 {
				continue
			}
			break
		}
		picked = append(picked, line)
		if len(picked) >= 2 {
			break
		}
	}
	if len(picked) == 0 {
		// 整段都是噪声时，取首行并硬截断
		first := strings.TrimSpace(strings.SplitN(msg, "\n", 2)[0])
		return clipEngineErrorRunes(first, 120)
	}
	out := strings.Join(picked, " · ")
	return clipEngineErrorRunes(out, 160)
}

func isEngineErrorNoiseLine(line string) bool {
	if strings.HasPrefix(line, "【系统规则】") || strings.HasPrefix(line, "【用户】") {
		return true
	}
	low := strings.ToLower(line)
	switch {
	case strings.HasPrefix(low, "workdir:"),
		strings.HasPrefix(low, "model:"),
		strings.HasPrefix(low, "provider:"),
		strings.HasPrefix(low, "approval:"),
		strings.HasPrefix(low, "sandbox:"),
		strings.HasPrefix(low, "reasoning effort:"),
		strings.HasPrefix(low, "openai "):
		return true
	}
	// 过长单行多半是 prompt 回显
	if utf8.RuneCountInString(line) > 240 {
		return true
	}
	return false
}

func clipEngineErrorRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	s = strings.Join(strings.Fields(s), " ")
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}
