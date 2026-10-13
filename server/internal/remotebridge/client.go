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

// Heartbeat sends registry metadata to the relay.
func (c *RelayClient) Heartbeat(ctx context.Context, actions []string) error {
	body := map[string]any{
		"registry_version": RegistryVersion,
		"actions":          actions,
	}
	return c.postJSON(ctx, c.deviceURL("/heartbeat"), c.headers(), body)
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

func (c *RelayClient) postJSON(ctx context.Context, url string, hdr http.Header, body any) error {
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
	return nil
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
