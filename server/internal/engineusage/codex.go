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

const codexUsageURL = "https://chatgpt.com/backend-api/wham/usage"

func fetchCodex(ctx context.Context) EngineUsage {
	out := EngineUsage{ID: "codex", OK: false, Source: "wham/usage"}
	token, accountID := readCodexAuth()
	if token == "" {
		out.Error = "未找到 Codex OAuth 凭证（~/.codex/auth.json）"
		return out
	}
	headers := map[string]string{
		"Accept":        "application/json",
		"Authorization": "Bearer " + token,
		"User-Agent":    "codex-cli",
	}
	if accountID != "" {
		headers["ChatGPT-Account-Id"] = accountID
	}
	body, status, err := doGET(ctx, codexUsageURL, headers)
	if err != nil {
		out.Error = "Codex 用量接口不可达: " + err.Error()
		return out
	}
	if status == http.StatusUnauthorized {
		out.Error = "Codex 令牌已失效，请在 Codex CLI 重新登录"
		return out
	}
	if status != http.StatusOK {
		out.Error = fmt.Sprintf("Codex 用量接口 HTTP %d", status)
		return out
	}
	mapped, err := MapCodexResponse(body)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.OK = true
	out.Plan = mapped.Plan
	out.Windows = mapped.Windows
	return out
}

type mappedEngine struct {
	Plan    string
	Windows []UsageWindow
}

// MapCodexResponse 将 wham/usage JSON 映射为窗口列表。
func MapCodexResponse(raw []byte) (mappedEngine, error) {
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return mappedEngine{}, fmt.Errorf("Codex 响应解析失败")
	}
	plan, _ := root["plan_type"].(string)
	if plan == "" {
		plan, _ = root["planType"].(string)
	}
	rate := asObject(root["rate_limit"])
	if rate == nil {
		rate = asObject(root["rateLimit"])
	}
	var windows []UsageWindow
	if rate != nil {
		if w := mapCodexWindow(asObject(rate["primary_window"]), "session", "5 小时", "主限额 · 约每 5 小时重置"); w != nil {
			windows = append(windows, *w)
		}
		if w := mapCodexWindow(asObject(rate["secondary_window"]), "weekly", "7 天", "每周限额"); w != nil {
			windows = append(windows, *w)
		}
	}
	if len(windows) == 0 {
		return mappedEngine{}, fmt.Errorf("Codex 响应缺少可用 rate_limit 窗口")
	}
	return mappedEngine{Plan: strings.TrimSpace(plan), Windows: windows}, nil
}

func mapCodexWindow(obj map[string]any, kind, label, hint string) *UsageWindow {
	if obj == nil {
		return nil
	}
	pct, ok := pickPercent(obj)
	if !ok {
		return nil
	}
	w := UsageWindow{
		Kind:        kind,
		Label:       label,
		Hint:        hint,
		UsedPercent: pct,
	}
	if mins := pickWindowMinutes(obj); mins > 0 {
		w.WindowMinutes = mins
	}
	if _, unix, ok := pickResetTime(obj); ok {
		w.ResetsAt = time.Unix(unix, 0).UTC().Format(time.RFC3339)
		w.ResetHint = resetHint(unix)
	}
	return &w
}

func readCodexAuth() (token, accountID string) {
	path := filepath.Join(codexHome(), "auth.json")
	root := readJSONFile(path)
	if root == nil {
		return "", ""
	}
	tokens := asObject(root["tokens"])
	if tokens == nil {
		return "", ""
	}
	if s, ok := tokens["access_token"].(string); ok {
		token = strings.TrimSpace(s)
	}
	if s, ok := tokens["account_id"].(string); ok {
		accountID = strings.TrimSpace(s)
	}
	return token, accountID
}
