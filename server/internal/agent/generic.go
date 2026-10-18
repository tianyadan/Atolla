package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// GenericAsk 用任意本机 CLI 跑一轮问答(兼容无 session 的调用方)。
func GenericAsk(ctx context.Context, bin, dir, systemPrompt, question, history string, onChunk func(string), timeout time.Duration, onActivity ActivityFn) (string, int, error) {
	return GenericAskMeta(ctx, bin, dir, systemPrompt, question, history, onChunk, timeout, onActivity, nil, "")
}

// GenericAskMeta 同 GenericAsk，支持 Cursor --resume 与 session/usage 回调。
// history 保留参数以兼容旧调用；v0.2.18 起调用方应传空，由引擎 resume 维护上下文。
func GenericAskMeta(ctx context.Context, bin, dir, systemPrompt, question, history string, onChunk func(string), timeout time.Duration, onActivity ActivityFn, onMeta MetaFn, resumeSession string) (string, int, error) {
	return genericAsk(ctx, bin, dir, systemPrompt, question, history, onChunk, timeout, onActivity, onMeta, resumeSession, false)
}

// GenericAskMetaTrusted 在用户已确认工作区信任后，为 Cursor Agent 附加 --trust 再执行。
func GenericAskMetaTrusted(ctx context.Context, bin, dir, systemPrompt, question, history string, onChunk func(string), timeout time.Duration, onActivity ActivityFn, onMeta MetaFn, resumeSession string) (string, int, error) {
	return genericAsk(ctx, bin, dir, systemPrompt, question, history, onChunk, timeout, onActivity, onMeta, resumeSession, true)
}

// IsCursorWorkspaceTrustRequired 判断 CLI 是否因工作区未信任而中止（无交互模式无法自行确认）。
func IsCursorWorkspaceTrustRequired(msg string) bool {
	return strings.Contains(msg, "Workspace Trust Required")
}

// CursorCLIArgs 构造 agent 打印模式参数。trust 为真时只追加 --trust，不使用 --yolo / -f。
func CursorCLIArgs(prompt, resume, mode string, trust bool) []string {
	args := make([]string, 0, 8)
	if trust {
		args = append(args, "--trust")
	}
	switch mode {
	case "stream-json":
		// 流式 JSON：中途已有 assistant/result 行，收尾解析失败时仍能取回正文。
		args = append(args, "-p", "--output-format", "stream-json")
	case "json":
		args = append(args, "-p", "--output-format", "json")
	case "text":
		args = append(args, "-p")
	}
	if rs := strings.TrimSpace(resume); rs != "" {
		args = append(args, "--resume", rs)
	}
	return append(args, prompt)
}

func genericAsk(ctx context.Context, bin, dir, systemPrompt, question, history string, onChunk func(string), timeout time.Duration, onActivity ActivityFn, onMeta MetaFn, resumeSession string, trust bool) (string, int, error) {
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	userInput := strings.TrimSpace(history)
	if userInput != "" {
		userInput += "\n\n"
	}
	userInput += question
	prompt := userInput
	if systemPrompt != "" {
		prompt = "【系统规则】\n" + systemPrompt + "\n\n【用户】\n" + userInput
	}

	if onActivity != nil {
		name := filepath.Base(bin)
		if name == "" {
			name = "agent"
		}
		onActivity(Activity{Tool: name, Summary: name + " 执行中…"})
	}

	start := time.Now()
	// 先 stream-json：任务完成后 CLI 常在写出 result 后又因 JSON.parse 失败退出。
	// 只要 stdout 里已有回复，就不再把这段 SyntaxError 当成整轮失败，也不重跑任务。
	var lastErr error
	var out string
	for _, mode := range []string{"stream-json", "json", "text", "bare"} {
		out, lastErr = runOnce(cctx, bin, dir, CursorCLIArgs(prompt, resumeSession, mode, trust))
		if lastErr != nil && IsCursorWorkspaceTrustRequired(lastErr.Error()) {
			return "", int(time.Since(start).Milliseconds()), lastErr
		}
		if text, meta, ok := cursorAnswer(out); ok {
			text, ms := deliverCursor(text, meta, onChunk, onMeta, start)
			return text, ms, nil
		}
		if lastErr == nil {
			text, meta := ParseCursorPrintOutput(out)
			text = stripCursorJSONParseNoise(text)
			if strings.TrimSpace(text) == "" {
				text = strings.TrimSpace(out)
			}
			text, ms := deliverCursor(text, meta, onChunk, onMeta, start)
			return text, ms, nil
		}
	}
	return "", int(time.Since(start).Milliseconds()), lastErr
}

// deliverCursor 把解析后的正文交给调用方，并回传 session/usage。
func deliverCursor(text string, meta RunMeta, onChunk func(string), onMeta MetaFn, start time.Time) (string, int) {
	if onMeta != nil && (meta.SessionID != "" || meta.InputTokens > 0 || meta.OutputTokens > 0) {
		onMeta(meta)
	}
	text = strings.TrimSpace(text)
	if onChunk != nil && text != "" {
		onChunk(text)
	}
	return text, int(time.Since(start).Milliseconds())
}

// ParseCursorPrintOutput 解析 agent -p --output-format json 的结果行；非 JSON 则全文当正文。
func ParseCursorPrintOutput(raw string) (text string, meta RunMeta) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", meta
	}
	// 可能多行：取最后一段像 JSON 的对象
	lines := strings.Split(raw, "\n")
	var lastObj string
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if strings.HasPrefix(l, "{") && strings.HasSuffix(l, "}") {
			lastObj = l
			break
		}
	}
	if lastObj == "" && strings.HasPrefix(raw, "{") {
		lastObj = raw
	}
	if lastObj == "" {
		return raw, meta
	}
	var m map[string]interface{}
	if json.Unmarshal([]byte(lastObj), &m) != nil {
		return raw, meta
	}
	if sid := ExtractSessionID(m); sid != "" {
		meta.SessionID = sid
	}
	if r, ok := m["result"].(string); ok {
		text = r
	}
	if u, _ := m["usage"].(map[string]interface{}); u != nil {
		meta.InputTokens = jsonInt64(u["inputTokens"])
		if meta.InputTokens == 0 {
			meta.InputTokens = jsonInt64(u["input_tokens"])
		}
		meta.OutputTokens = jsonInt64(u["outputTokens"])
		if meta.OutputTokens == 0 {
			meta.OutputTokens = jsonInt64(u["output_tokens"])
		}
		meta.CacheRead = jsonInt64(u["cacheReadTokens"])
		if meta.CacheRead == 0 {
			meta.CacheRead = jsonInt64(u["cache_read_input_tokens"])
		}
		meta.CacheWrite = jsonInt64(u["cacheWriteTokens"])
	}
	// Cursor 仅有本轮 usage，无 active context API → 估算。
	meta.UsedTokens = meta.InputTokens + meta.CacheRead
	meta.Estimated = true
	if text == "" {
		text = raw
	}
	return text, meta
}

// cursorAnswer 从 Cursor stdout 取出已完成的回复。
// 进程在写出 result 之后因 JSON.parse 失败退出时，stdout 里仍有这段正文。
func cursorAnswer(raw string) (string, RunMeta, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", RunMeta{}, false
	}
	var meta RunMeta
	var assistant strings.Builder
	result := ""
	sawResult := false
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var m map[string]interface{}
		if json.Unmarshal([]byte(line), &m) != nil {
			continue
		}
		if sid := ExtractSessionID(m); sid != "" {
			meta.SessionID = sid
		}
		fillCursorUsage(&meta, m)
		switch strAny(m["type"]) {
		case "assistant":
			if t := cursorAssistantText(m); t != "" {
				if assistant.Len() > 0 {
					assistant.WriteByte('\n')
				}
				assistant.WriteString(t)
			}
		case "result", "":
			if r, ok := m["result"].(string); ok {
				result = r
				sawResult = true
			}
		}
	}
	if sawResult && strings.TrimSpace(result) != "" {
		return stripCursorJSONParseNoise(result), meta, true
	}
	if assistant.Len() > 0 {
		return stripCursorJSONParseNoise(assistant.String()), meta, true
	}
	if sawResult {
		return "", meta, true
	}
	return "", meta, false
}

// cursorAssistantText 取 stream-json assistant 事件里的文本块。
func cursorAssistantText(m map[string]interface{}) string {
	msg, _ := m["message"].(map[string]interface{})
	if msg == nil {
		return ""
	}
	parts, _ := msg["content"].([]interface{})
	var b strings.Builder
	for _, it := range parts {
		part, _ := it.(map[string]interface{})
		if part == nil || strAny(part["type"]) != "text" {
			continue
		}
		if t, _ := part["text"].(string); t != "" {
			b.WriteString(t)
		}
	}
	return b.String()
}

// fillCursorUsage 从 result.usage 填本轮 token。
func fillCursorUsage(meta *RunMeta, m map[string]interface{}) {
	u, _ := m["usage"].(map[string]interface{})
	if u == nil || meta == nil {
		return
	}
	if n := jsonInt64(u["inputTokens"]); n != 0 {
		meta.InputTokens = n
	} else if n := jsonInt64(u["input_tokens"]); n != 0 {
		meta.InputTokens = n
	}
	if n := jsonInt64(u["outputTokens"]); n != 0 {
		meta.OutputTokens = n
	} else if n := jsonInt64(u["output_tokens"]); n != 0 {
		meta.OutputTokens = n
	}
	if n := jsonInt64(u["cacheReadTokens"]); n != 0 {
		meta.CacheRead = n
	} else if n := jsonInt64(u["cache_read_input_tokens"]); n != 0 {
		meta.CacheRead = n
	}
	if n := jsonInt64(u["cacheWriteTokens"]); n != 0 {
		meta.CacheWrite = n
	}
	meta.UsedTokens = meta.InputTokens + meta.CacheRead
	meta.Estimated = true
}

// stripCursorJSONParseNoise 去掉 CLI 收尾时打出的 JSON.parse SyntaxError 行。
func stripCursorJSONParseNoise(s string) string {
	lines := strings.Split(s, "\n")
	kept := make([]string, 0, len(lines))
	for _, ln := range lines {
		trim := strings.TrimSpace(ln)
		if strings.Contains(trim, "Expected double-quoted property name in JSON") {
			continue
		}
		if strings.HasPrefix(trim, "SyntaxError:") && strings.Contains(trim, "JSON") {
			continue
		}
		kept = append(kept, ln)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

func runOnce(ctx context.Context, bin, dir string, args []string) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	AttachKillable(cmd)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = CleanEnv(os.Environ())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		// 非 0 退出仍带回 stdout：Cursor 可能已写出 result，随后才在收尾 JSON.parse 失败。
		return stdout.String(), fmt.Errorf("%s: %s", bin, msg)
	}
	s := stdout.String()
	if strings.TrimSpace(s) == "" {
		s = stderr.String()
	}
	return s, nil
}
