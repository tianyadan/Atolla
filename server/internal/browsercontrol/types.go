package browsercontrol

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

const (
	DefaultTimeoutMS    = 15000
	ChatGPTMinTimeoutMS = 10000
	ChatGPTTimeoutMS    = 180000
	MaxTimeoutMS        = 300000
)

var taskIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

var supportedActions = map[string]struct{}{
	"tabs.list":            {},
	"tabs.open":            {},
	"dom.read":             {},
	"dom.input":            {},
	"dom.click":            {},
	"page.content":         {},
	"page.screenshot":      {},
	"chatgpt.send_message": {},
}

// TaskRequest 是 Atolla REST API 接收的固定浏览器动作，不接受任意脚本。
type TaskRequest struct {
	TaskID    string          `json:"task_id,omitempty"`
	Action    string          `json:"action"`
	TimeoutMS int             `json:"timeout_ms,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
}

// Response 是 REST 与 WebSocket 任务结果共用的统一响应。
type Response struct {
	OK         bool            `json:"ok"`
	TaskID     string          `json:"task_id,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
	Error      string          `json:"error,omitempty"`
	Code       string          `json:"code,omitempty"`
	DurationMS int64           `json:"duration_ms,omitempty"`
}

type helloMessage struct {
	Type     string `json:"type"`
	Token    string `json:"token"`
	ClientID string `json:"client_id,omitempty"`
	Version  string `json:"version,omitempty"`
}

type socketMessage struct {
	Type      string          `json:"type"`
	TaskID    string          `json:"task_id,omitempty"`
	Action    string          `json:"action,omitempty"`
	TimeoutMS int             `json:"timeout_ms,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	OK        bool            `json:"ok,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	Error     string          `json:"error,omitempty"`
	Code      string          `json:"code,omitempty"`
}

type helloAck struct {
	Type           string   `json:"type"`
	AllowedDomains []string `json:"allowed_domains"`
}

// NormalizeTask 校验动作、任务 ID、超时和参数大小。
func NormalizeTask(req TaskRequest, allowedDomains []string) (TaskRequest, error) {
	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	if _, ok := supportedActions[req.Action]; !ok {
		return req, fmt.Errorf("unsupported browser action: %s", req.Action)
	}
	if req.TaskID == "" {
		req.TaskID = newTaskID()
	} else if !taskIDPattern.MatchString(req.TaskID) {
		return req, fmt.Errorf("invalid task_id")
	}
	if req.TimeoutMS <= 0 {
		if req.Action == "chatgpt.send_message" {
			req.TimeoutMS = ChatGPTTimeoutMS
		} else {
			req.TimeoutMS = DefaultTimeoutMS
		}
	}
	if req.TimeoutMS < 100 {
		req.TimeoutMS = 100
	}
	if req.Action == "chatgpt.send_message" && req.TimeoutMS < ChatGPTMinTimeoutMS {
		req.TimeoutMS = ChatGPTMinTimeoutMS
	}
	if req.TimeoutMS > MaxTimeoutMS {
		req.TimeoutMS = MaxTimeoutMS
	}
	if len(req.Params) == 0 {
		req.Params = json.RawMessage(`{}`)
	}
	if len(req.Params) > 512*1024 {
		return req, fmt.Errorf("params too large")
	}
	var params map[string]any
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return req, fmt.Errorf("invalid params: %w", err)
	}
	for _, forbidden := range []string{"script", "javascript", "code", "function"} {
		if _, ok := params[forbidden]; ok {
			return req, fmt.Errorf("arbitrary JavaScript is not allowed")
		}
	}
	if selector, _ := params["selector"].(string); len(selector) > 4096 {
		return req, fmt.Errorf("selector too long")
	}
	if text, _ := params["text"].(string); len(text) > 100000 {
		return req, fmt.Errorf("input text too long")
	}
	if req.Action == "chatgpt.send_message" {
		text, _ := params["text"].(string)
		if strings.TrimSpace(text) == "" {
			return req, fmt.Errorf("chatgpt message text is required")
		}
	}
	if req.Action == "tabs.open" {
		rawURL, _ := params["url"].(string)
		if !URLAllowed(rawURL, allowedDomains) {
			return req, fmt.Errorf("target URL is not in browser domain allowlist")
		}
	}
	return req, nil
}

func newTaskID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "task-fallback"
	}
	return "task-" + hex.EncodeToString(buf)
}

// NormalizeDomains 清理域名规则；空配置只允许本机页面。
func NormalizeDomains(domains []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(domains)+2)
	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		domain = strings.TrimSuffix(domain, ".")
		if domain == "" || strings.ContainsAny(domain, "/:?#") {
			continue
		}
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		out = append(out, domain)
	}
	if len(out) == 0 {
		return []string{"localhost", "127.0.0.1"}
	}
	return out
}

// URLAllowed 同时支持精确主机和 *.example.com 子域规则。
func URLAllowed(rawURL string, domains []string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	for _, rule := range NormalizeDomains(domains) {
		if strings.HasPrefix(rule, "*.") {
			base := strings.TrimPrefix(rule, "*.")
			if host != base && strings.HasSuffix(host, "."+base) {
				return true
			}
			continue
		}
		if host == rule {
			return true
		}
	}
	return false
}
