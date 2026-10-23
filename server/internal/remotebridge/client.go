package remotebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultLongPollWaitMS = 25000

// RelayClient calls remote-relay device APIs with instance headers.
type RelayClient struct {
	BaseURL    string
	InstanceID string
	Password   string
	HTTP       *http.Client
}

func (c *RelayClient) headers() http.Header {
	h := make(http.Header)
	h.Set("X-Instance-Id", c.InstanceID)
	h.Set("X-Instance-Password", c.Password)
	h.Set("Content-Type", "application/json")
	return h
}

func (c *RelayClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 120 * time.Second}
}

func (c *RelayClient) deviceURL(path string) string {
	base := strings.TrimRight(c.BaseURL, "/")
	return base + "/api/device" + path
}

// Register registers or rotates the instance on the relay.
// priorPassword is the current relay password when rotating; empty uses c.Password for auth headers.
func (c *RelayClient) Register(ctx context.Context, displayName string, actions []string, priorPassword string) error {
	authPass := strings.TrimSpace(priorPassword)
	if authPass == "" {
		authPass = c.Password
	}
	hdr := make(http.Header)
	hdr.Set("X-Instance-Id", c.InstanceID)
	hdr.Set("X-Instance-Password", authPass)
	hdr.Set("Content-Type", "application/json")
	body := map[string]any{
		"instance_id":      c.InstanceID,
		"display_name":     displayName,
		"password":         c.Password,
		"registry_version": RegistryVersion,
		"actions":          actions,
	}
	return c.postJSON(ctx, c.deviceURL("/register"), hdr, body)
}

// IsTooManyRequests 判断中继是否因为注册过于频繁返回了 429。
func IsTooManyRequests(err error) bool {
	return err != nil && strings.Contains(err.Error(), "429")
}

// IsUnauthorized 判断中继是否拒绝了实例密码。
func IsUnauthorized(err error) bool {
	return err != nil && strings.Contains(err.Error(), "401")
}

// RegisterDidNotCommit 判断这次注册的 HTTP 响应是否明确表示中继没有改密码。
// 网络中断或 5xx 可能发生在中继已经写入之后，此时不能丢掉本机提前保存的新密码。
func RegisterDidNotCommit(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "400") ||
		strings.Contains(msg, "401") ||
		strings.Contains(msg, "403") ||
		strings.Contains(msg, "429")
}

// RegisterRetrying 在中继限流时等待并重试，直到窗口过去或 ctx 结束。
func (c *RelayClient) RegisterRetrying(ctx context.Context, displayName string, actions []string, priorPassword string) error {
	var last error
	for attempt := 0; attempt < 5; attempt++ {
		last = c.Register(ctx, displayName, actions, priorPassword)
		if last == nil || !IsTooManyRequests(last) {
			return last
		}
		timer := time.NewTimer(15 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return last
		case <-timer.C:
		}
	}
	return last
}

// HeartbeatResult is the relay heartbeat response (presence fields optional).
type HeartbeatResult struct {
	OK                   bool   `json:"ok"`
	MobileViewingAgentID string `json:"mobile_viewing_agent_id"`
}

// Heartbeat sends registry metadata (+ optional host metrics / SMTP ready) to the relay.
func (c *RelayClient) Heartbeat(ctx context.Context, actions []string, unlockOtpSmtpOk bool) (*HeartbeatResult, error) {
	body := map[string]any{
		"registry_version":    RegistryVersion,
		"actions":             actions,
		"unlock_otp_smtp_ok":  unlockOtpSmtpOk,
	}
	hm := CollectHostMetrics()
	hostMap := map[string]any{
		"os":         hm.OS,
		"ip":         hm.IP,
		"uptime_sec": hm.UptimeSec,
		"cpu_pct":    hm.CPUPct,
		"mem_pct":    hm.MemPct,
		"disk_pct":   hm.DiskPct,
	}
	if hm.TempC != nil {
		hostMap["temp_c"] = *hm.TempC
	}
	body["host"] = hostMap
	var out HeartbeatResult
	if err := c.postJSONDecode(ctx, c.deviceURL("/heartbeat"), c.headers(), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeviceCommand is one leased command from long-poll.
type DeviceCommand struct {
	ID      string                 `json:"id"`
	Action  string                 `json:"action"`
	Payload map[string]interface{} `json:"payload"`
	Status  string                 `json:"status"`
}

// LongPoll waits for pending commands.
func (c *RelayClient) LongPoll(ctx context.Context, waitMS int) ([]DeviceCommand, error) {
	if waitMS <= 0 {
		waitMS = defaultLongPollWaitMS
	}
	u, err := url.Parse(c.deviceURL("/commands/long-poll"))
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("wait_ms", fmt.Sprintf("%d", waitMS))
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header = c.headers()

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, readAPIError(resp)
	}
	var out struct {
		Commands []DeviceCommand `json:"commands"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Commands, nil
}

// SubmitCommandResult posts done/error/rejected for a command id.
func (c *RelayClient) SubmitCommandResult(ctx context.Context, commandID, status string, body any) error {
	payload := map[string]any{"status": status}
	if body != nil {
		payload["body"] = body
	}
	path := fmt.Sprintf("/commands/%s/result", url.PathEscape(commandID))
	return c.postJSON(ctx, c.deviceURL(path), c.headers(), payload)
}

// PostAgentsSnapshot pushes agent mirror rows.
func (c *RelayClient) PostAgentsSnapshot(ctx context.Context, agents []map[string]any) error {
	return c.postJSON(ctx, c.deviceURL("/snapshot/agents"), c.headers(), map[string]any{"agents": agents})
}

// PostTasksSnapshot pushes task mirror rows.
func (c *RelayClient) PostTasksSnapshot(ctx context.Context, tasks []map[string]any) error {
	return c.postJSON(ctx, c.deviceURL("/snapshot/tasks"), c.headers(), map[string]any{"tasks": tasks})
}

// PostMessagesSnapshot pushes message mirror rows.
func (c *RelayClient) PostMessagesSnapshot(ctx context.Context, messages []map[string]any) error {
	return c.postJSON(ctx, c.deviceURL("/snapshot/messages"), c.headers(), map[string]any{"messages": messages})
}

// PostPermissionsSnapshot upserts pending permission cards on the relay.
func (c *RelayClient) PostPermissionsSnapshot(ctx context.Context, permissions []map[string]any) error {
	return c.postJSON(ctx, c.deviceURL("/snapshot/permissions"), c.headers(), map[string]any{
		"permissions": permissions,
	})
}

// PostPermissionsResolved deletes resolved permission cards on the relay.
func (c *RelayClient) PostPermissionsResolved(ctx context.Context, requestIDs []string) error {
	return c.postJSON(ctx, c.deviceURL("/permissions/resolved"), c.headers(), map[string]any{
		"request_ids": requestIDs,
	})
}

// MobileDeviceSession is one phone unlock session on the relay.
type MobileDeviceSession struct {
	SessionID   string `json:"session_id"`
	DeviceLabel string `json:"device_label"`
	UserAgent   string `json:"user_agent"`
	ClientIP    string `json:"client_ip"`
	CreatedAt   int64  `json:"created_at"`
	ExpiresAt   int64  `json:"expires_at"`
	LastSeenAt  int64  `json:"last_seen_at"`
	Online      bool   `json:"online"`
	Revoked     bool   `json:"revoked"`
}

// ListMobileSessions returns unlock sessions for this instance.
func (c *RelayClient) ListMobileSessions(ctx context.Context) ([]MobileDeviceSession, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.deviceURL("/mobile-sessions"), nil)
	if err != nil {
		return nil, err
	}
	req.Header = c.headers()
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, readAPIError(resp)
	}
	var out struct {
		Sessions []MobileDeviceSession `json:"sessions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out.Sessions == nil {
		out.Sessions = []MobileDeviceSession{}
	}
	return out.Sessions, nil
}

// KickMobileSession revokes one phone unlock session on the relay.
func (c *RelayClient) KickMobileSession(ctx context.Context, sessionID string) error {
	sid := strings.TrimSpace(sessionID)
	if sid == "" {
		return fmt.Errorf("session id required")
	}
	u := c.deviceURL("/mobile-sessions/" + url.PathEscape(sid))
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
	if err != nil {
		return err
	}
	req.Header = c.headers()
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return readAPIError(resp)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *RelayClient) postJSON(ctx context.Context, url string, hdr http.Header, body any) error {
	return c.postJSONDecode(ctx, url, hdr, body, nil)
}

func (c *RelayClient) postJSONDecode(ctx context.Context, url string, hdr http.Header, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	if hdr != nil {
		req.Header = hdr
	} else {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return readAPIError(resp)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func readAPIError(resp *http.Response) error {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var parsed struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(b, &parsed)
	if parsed.Error != "" {
		return fmt.Errorf("relay %s: %s", resp.Status, parsed.Error)
	}
	return fmt.Errorf("relay %s: %s", resp.Status, strings.TrimSpace(string(b)))
}
