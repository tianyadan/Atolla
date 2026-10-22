package engineusage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

const claudeUsageURL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1"

func fetchClaude(ctx context.Context) EngineUsage {
	out := EngineUsage{ID: "claude", OK: false, Source: "oauth/api"}
	token := readClaudeToken()
	if token == "" {
		out.Error = "未找到 Claude OAuth 凭证（~/.claude/.credentials.json）"
		return out
	}
	headers := map[string]string{
		"Accept":         "application/json",
		"Authorization":  "Bearer " + token,
		"anthropic-beta": "oauth-2025-04-20",
		"User-Agent":     "claude-cli/0.0.0 (external, cli)",
	}
	body, status, err := doGET(ctx, claudeUsageURL, headers)
	if err != nil {
		out.Error = "Claude 用量接口不可达: " + err.Error()
		return out
	}
	if status == http.StatusUnauthorized {
		out.Error = "Claude 令牌已失效，请重新登录 Claude Code"
		return out
	}
	if status != http.StatusOK {
		out.Error = fmt.Sprintf("Claude 用量接口 HTTP %d", status)
		return out
	}
	mapped, err := MapClaudeResponse(body)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.OK = true
	out.Plan = mapped.Plan
	out.Windows = mapped.Windows
	return out
}

// MapClaudeResponse 将 oauth/usage JSON 映射为 session/weekly 窗口。
func MapClaudeResponse(raw []byte) (mappedEngine, error) {
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return mappedEngine{}, fmt.Errorf("Claude 响应解析失败")
	}
	plan := pickClaudePlan(root)
	windows := []UsageWindow{}
	if w := mapClaudeWindowKey(root, "five_hour", "session", "5 小时", "主限额 · 约每 5 小时重置", 300); w != nil {
		windows = append(windows, *w)
	}
	if w := mapClaudeWindowKey(root, "seven_day", "weekly", "7 天", "每周限额", 7*24*60); w != nil {
		windows = append(windows, *w)
	}
	if len(windows) == 0 {
		return mappedEngine{}, fmt.Errorf("Claude 响应缺少 five_hour / seven_day 窗口")
	}
	return mappedEngine{Plan: plan, Windows: windows}, nil
}

func pickClaudePlan(root map[string]any) string {
	for _, key := range []string{"subscription_type", "subscriptionType", "rate_limit_tier", "rateLimitTier"} {
		if s, ok := root[key].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func mapClaudeWindowKey(root map[string]any, field, kind, label, hint string, defaultMinutes int) *UsageWindow {
	obj := asObject(root[field])
	if obj == nil {
		if nested := asObject(root["usage"]); nested != nil {
			obj = asObject(nested[field])
		}
	}
	if obj == nil {
		return nil
	}
	pct, ok := pickPercent(obj)
	if !ok {
		return nil
	}
	w := UsageWindow{
		Kind:          kind,
		Label:         label,
		Hint:          hint,
		UsedPercent:   pct,
		WindowMinutes: defaultMinutes,
	}
	if mins := pickWindowMinutes(obj); mins > 0 {
		w.WindowMinutes = mins
	}
	if rfc, unix, ok := pickResetTime(obj); ok {
		w.ResetsAt = rfc
		w.ResetHint = resetHint(unix)
	} else if s, ok := obj["resets_at"].(string); ok && strings.TrimSpace(s) != "" {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(s)); err == nil {
			w.ResetsAt = t.UTC().Format(time.RFC3339)
			w.ResetHint = resetHint(t.Unix())
		}
	}
	return &w
}

func readClaudeToken() string {
	if h := homeDir(); h != "" {
		path := filepath.Join(h, ".claude", ".credentials.json")
		if root := readJSONFile(path); root != nil {
			if tok := findStringToken(root); tok != "" {
				return tok
			}
		}
	}
	return ""
}
