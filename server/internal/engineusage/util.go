package engineusage

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var shanghaiLoc = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}()

// homeDir 返回用户主目录，测试可通过 SetHomeDir 覆盖。
func homeDir() string {
	if testHome != "" {
		return testHome
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return ""
}

// codexHome 解析 Codex 配置目录（$CODEX_HOME 或 ~/.codex）。
func codexHome() string {
	if testCodexHome != "" {
		return testCodexHome
	}
	if v := strings.TrimSpace(os.Getenv("CODEX_HOME")); v != "" {
		return v
	}
	if h := homeDir(); h != "" {
		return filepath.Join(h, ".codex")
	}
	return ""
}

// readJSONFile 读取 JSON 文件到 map，失败返回 nil。
func readJSONFile(path string) map[string]any {
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		return nil
	}
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return out
}

// findStringToken 在任意 JSON 结构中递归查找 access_token / accessToken。
func findStringToken(v any) string {
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			kl := strings.ToLower(k)
			if kl == "access_token" || kl == "accesstoken" {
				if s, ok := val.(string); ok && strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			}
			if s := findStringToken(val); s != "" {
				return s
			}
		}
	case []any:
		for _, item := range x {
			if s := findStringToken(item); s != "" {
				return s
			}
		}
	}
	return ""
}

// pickPercent 从窗口对象解析已用百分比（0–100）。
func pickPercent(obj map[string]any) (int, bool) {
	keys := []string{"used_percent", "usedPercent", "percent", "utilization", "used"}
	for _, key := range keys {
		v, ok := obj[key]
		if !ok {
			continue
		}
		if pct, ok := numberToPercent(v); ok {
			return pct, true
		}
	}
	return 0, false
}

func numberToPercent(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		if n >= 0 && n <= 1 {
			return int(math.Round(n * 100)), true
		}
		return int(math.Round(n)), true
	case json.Number:
		f, err := n.Float64()
		if err != nil {
			return 0, false
		}
		return numberToPercent(f)
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false
		}
		return numberToPercent(f)
	case int:
		return int(n), true
	case int64:
		return int(n), true
	default:
		return 0, false
	}
}

// pickResetTime 解析重置时间为 RFC3339 字符串与 Unix 秒。
func pickResetTime(obj map[string]any) (rfc3339 string, unixSec int64, ok bool) {
	keys := []string{"resets_at", "reset_at", "resetAt", "resetsAt"}
	for _, key := range keys {
		v, exists := obj[key]
		if !exists {
			continue
		}
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			if t, err := time.Parse(time.RFC3339, strings.TrimSpace(s)); err == nil {
				return t.UTC().Format(time.RFC3339), t.Unix(), true
			}
			if t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(s)); err == nil {
				return t.UTC().Format(time.RFC3339), t.Unix(), true
			}
		}
		if f, ok := numberToFloat(v); ok && f > 0 {
			t := time.Unix(int64(f), 0).UTC()
			return t.Format(time.RFC3339), int64(f), true
		}
	}
	return "", 0, false
}

func numberToFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

// pickWindowMinutes 从 limit_window_seconds 等字段得到窗口分钟数。
func pickWindowMinutes(obj map[string]any) int {
	keys := []string{"limit_window_seconds", "limitWindowSeconds", "window_seconds", "windowSeconds"}
	for _, key := range keys {
		if v, ok := obj[key]; ok {
			if f, ok := numberToFloat(v); ok && f > 0 {
				return int(math.Round(f / 60))
			}
		}
	}
	return 0
}

// resetHint 生成精确的中文重置时间提示。仅显示时分会让 7 天窗口跨日时产生歧义。
func resetHint(unixSec int64) string {
	if unixSec <= 0 {
		return ""
	}
	t := time.Unix(unixSec, 0).In(shanghaiLoc)
	return "下次重置 " + t.Format("2006-01-02 15:04") + "（北京时间）"
}

func asObject(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}
