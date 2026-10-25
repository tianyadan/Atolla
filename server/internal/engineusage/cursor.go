package engineusage

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const cursorUsageURL = "https://cursor.com/api/usage-summary"

func fetchCursor(ctx context.Context) EngineUsage {
	out := EngineUsage{ID: "cursor", OK: false, Source: "usage-summary"}
	token, src, err := readCursorAccessToken()
	if err != nil || token == "" {
		out.Error = "未检测到 Cursor 登录会话"
		if err != nil && !strings.Contains(out.Error, err.Error()) {
			out.Error = out.Error + ": " + err.Error()
		}
		return out
	}
	cookie, ok := workosSessionCookie(token)
	if !ok {
		out.Error = "Cursor 凭证格式无法解析为会话 Cookie"
		return out
	}
	headers := map[string]string{
		"Accept": "application/json",
		"Cookie": cookie,
	}
	body, status, err := doGET(ctx, cursorUsageURL, headers)
	if err != nil {
		out.Error = "Cursor 用量接口不可达: " + err.Error()
		return out
	}
	if status == http.StatusUnauthorized {
		out.Error = "Cursor 会话已失效，请在 Cursor IDE 或 CLI 重新登录"
		return out
	}
	if status != http.StatusOK {
		out.Error = fmt.Sprintf("Cursor 用量接口 HTTP %d", status)
		return out
	}
	mapped, err := MapCursorResponse(body)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.OK = true
	out.Source = src
	out.Plan = mapped.Plan
	out.Windows = mapped.Windows
	return out
}

// MapCursorResponse 将 usage-summary JSON 映射为月度主窗口与可选次级窗口。
func MapCursorResponse(raw []byte) (mappedEngine, error) {
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return mappedEngine{}, fmt.Errorf("Cursor 响应解析失败")
	}
	plan, _ := root["membershipType"].(string)
	if plan == "" {
		plan, _ = root["membership_type"].(string)
	}
	var windows []UsageWindow
	ind := asObject(root["individualUsage"])
	if ind == nil {
		ind = asObject(root["individual_usage"])
	}
	planUsage := asObject(nil)
	if ind != nil {
		planUsage = asObject(ind["plan"])
	}
	if planUsage != nil {
		var pct int
		var hasPct bool
		if v, exists := planUsage["totalPercentUsed"]; exists {
			pct, hasPct = numberToPercent(v)
		} else if v, exists := planUsage["total_percent_used"]; exists {
			pct, hasPct = numberToPercent(v)
		} else {
			pct, hasPct = pickPercent(planUsage)
		}
		if hasPct {
			w := UsageWindow{
				Kind:        "monthly",
				Label:       "月度",
				Hint:        "当前账单周期 included 用量",
				UsedPercent: pct,
			}
			if end, ok := root["billingCycleEnd"].(string); ok && strings.TrimSpace(end) != "" {
				if t, err := time.Parse(time.RFC3339, strings.TrimSpace(end)); err == nil {
					w.ResetsAt = t.UTC().Format(time.RFC3339)
					w.ResetHint = resetHint(t.Unix())
				}
			}
			windows = append(windows, w)
			if v, exists := planUsage["autoPercentUsed"]; exists {
				if autoPct, ok := numberToPercent(v); ok && autoPct != pct {
					windows = append(windows, UsageWindow{
						Kind:        "session",
						Label:       "Auto 模型",
						Hint:        "included 总量中的 Auto 模型占比",
						UsedPercent: autoPct,
					})
				}
			}
		}
	}
	// Cursor 可能在 individualUsage 下新增第三方 API、特定模型（如 Grok）等独立配额。
	// 不写死供应商名：只收集带明确百分比字段的对象，接口扩展后前端详情即可自动展示。
	windows = append(windows, mapCursorAdditionalWindows(ind)...)
	if len(windows) == 0 {
		return mappedEngine{}, fmt.Errorf("Cursor 响应缺少 individualUsage.plan")
	}
	return mappedEngine{Plan: strings.TrimSpace(plan), Windows: windows}, nil
}

// mapCursorAdditionalWindows 收集 Cursor 返回的扩展额度项；plan 已由主窗口单独处理，避免重复。
func mapCursorAdditionalWindows(ind map[string]any) []UsageWindow {
	if ind == nil {
		return nil
	}
	windows := make([]UsageWindow, 0)
	for key, raw := range ind {
		if key == "plan" {
			continue
		}
		obj := asObject(raw)
		if obj == nil {
			continue
		}
		pct, ok := pickCursorPercent(obj)
		if !ok {
			continue
		}
		windows = append(windows, UsageWindow{
			Kind:        "cursor_" + key,
			Label:       cursorUsageLabel(key, obj),
			Hint:        "Cursor 返回的独立用量项",
			UsedPercent: pct,
		})
	}
	return windows
}

// pickCursorPercent 只接受语义明确的百分比字段，避免把金额或 token 数误显示为百分比。
func pickCursorPercent(obj map[string]any) (int, bool) {
	for _, key := range []string{
		"totalPercentUsed", "total_percent_used", "autoPercentUsed", "auto_percent_used",
		"usedPercent", "used_percent", "percentUsed", "percent_used", "usagePercent", "usage_percent", "percent",
	} {
		if value, exists := obj[key]; exists {
			return numberToPercent(value)
		}
	}
	return 0, false
}

func cursorUsageLabel(key string, obj map[string]any) string {
	for _, field := range []string{"displayName", "display_name", "label", "name", "modelName", "model_name"} {
		if value, ok := obj[field].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	var out []rune
	for index, r := range []rune(key) {
		if index > 0 && r >= 'A' && r <= 'Z' {
			out = append(out, ' ')
		}
		if r == '_' || r == '-' {
			out = append(out, ' ')
			continue
		}
		out = append(out, r)
	}
	return strings.TrimSpace(string(out))
}

// readCursorAccessToken 只读方式收集 Cursor access token（CLI 文件优先，其次 IDE sqlite）。
func readCursorAccessToken() (token, source string, err error) {
	if tok := readCursorCLIAuth(); tok != "" {
		return tok, "usage-summary", nil
	}
	if tok, err := readCursorIDEToken(); tok != "" {
		return tok, "usage-summary", nil
	} else if err != nil {
		return "", "", err
	}
	return "", "", nil
}

func readCursorCLIAuth() string {
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		if h := homeDir(); h != "" {
			configHome = filepath.Join(h, ".config")
		}
	}
	if configHome == "" {
		return ""
	}
	path := filepath.Join(configHome, "cursor", "auth.json")
	root := readJSONFile(path)
	if root == nil {
		return ""
	}
	if s, ok := root["accessToken"].(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	if s, ok := root["access_token"].(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return findStringToken(root)
}

func readCursorIDEToken() (string, error) {
	if runtime.GOOS != "darwin" {
		return "", nil
	}
	h := homeDir()
	if h == "" {
		return "", nil
	}
	dbPath := filepath.Join(h, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
	if _, err := os.Stat(dbPath); err != nil {
		return "", nil
	}
	if _, err := exec.LookPath("sqlite3"); err != nil {
		return "", fmt.Errorf("本机无 sqlite3，无法读取 Cursor IDE 会话库")
	}
	queries := []string{
		`SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken' LIMIT 1;`,
		`SELECT value FROM ItemTable WHERE key LIKE '%accessToken%' AND length(value) > 40 LIMIT 1;`,
	}
	for _, q := range queries {
		out, err := exec.Command("sqlite3", dbPath, q).Output()
		if err != nil {
			continue
		}
		tok := strings.TrimSpace(string(out))
		if tok != "" {
			return tok, nil
		}
	}
	return "", nil
}

// workosSessionCookie 由 JWT access token 构造 WorkosCursorSessionToken Cookie。
func workosSessionCookie(accessToken string) (string, bool) {
	parts := strings.Split(accessToken, ".")
	if len(parts) < 2 {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	var claims map[string]any
	if json.Unmarshal(payload, &claims) != nil {
		return "", false
	}
	sub, _ := claims["sub"].(string)
	sub = strings.TrimSpace(sub)
	if sub == "" {
		return "", false
	}
	userID := sub
	if i := strings.LastIndex(sub, "|"); i >= 0 {
		userID = sub[i+1:]
	}
	if !strings.HasPrefix(userID, "user_") {
		return "", false
	}
	return fmt.Sprintf("WorkosCursorSessionToken=%s%%3A%%3A%s", userID, accessToken), true
}
