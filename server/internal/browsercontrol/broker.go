package browsercontrol

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type clientConn struct {
	conn     *websocket.Conn
	writeMu  sync.Mutex
	clientID string
	version  string
	seenAt   time.Time
}

func (c *clientConn) writeJSON(v any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteJSON(v)
}

type pendingTask struct {
	client *clientConn
	result chan Response
}

// Broker 管理唯一 Chrome 扩展连接和 REST 任务等待队列。
type Broker struct {
	mu             sync.Mutex
	token          string
	allowedDomains []string
	allowRemote    bool
	client         *clientConn
	pending        map[string]pendingTask
	closed         bool
}

func New(token string, allowedDomains []string, allowRemote bool) *Broker {
	return &Broker{
		token:          strings.TrimSpace(token),
		allowedDomains: NormalizeDomains(allowedDomains),
		allowRemote:    allowRemote,
		pending:        map[string]pendingTask{},
	}
}

type Status struct {
	OK             bool     `json:"ok"`
	Configured     bool     `json:"configured"`
	Connected      bool     `json:"connected"`
	ClientID       string   `json:"client_id,omitempty"`
	Version        string   `json:"version,omitempty"`
	LastSeenAt     string   `json:"last_seen_at,omitempty"`
	AllowedDomains []string `json:"allowed_domains"`
	PendingTasks   int      `json:"pending_tasks"`
}

func (b *Broker) Status() Status {
	b.mu.Lock()
	defer b.mu.Unlock()
	st := Status{
		OK:             true,
		Configured:     b.token != "",
		Connected:      b.client != nil,
		AllowedDomains: append([]string(nil), b.allowedDomains...),
		PendingTasks:   len(b.pending),
	}
	if b.client != nil {
		st.ClientID = b.client.clientID
		st.Version = b.client.version
		st.LastSeenAt = b.client.seenAt.UTC().Format(time.RFC3339)
	}
	return st
}

func (b *Broker) TokenValid(candidate string) bool {
	expected := []byte(b.token)
	actual := []byte(strings.TrimSpace(candidate))
	return len(expected) > 0 && len(expected) == len(actual) && subtle.ConstantTimeCompare(expected, actual) == 1
}

func (b *Broker) AllowRequest(remoteAddr string) bool {
	return b.allowRemote || isLoopback(remoteAddr)
}

func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (b *Broker) ServeWebSocket(w http.ResponseWriter, r *http.Request) {
	if !b.AllowRequest(r.RemoteAddr) {
		http.Error(w, "browser control only accepts local clients", http.StatusForbidden)
		return
	}
	if strings.TrimSpace(b.token) == "" {
		http.Error(w, "browser control token is not configured", http.StatusServiceUnavailable)
		return
	}
	upgrader := websocket.Upgrader{
		HandshakeTimeout: 5 * time.Second,
		CheckOrigin: func(r *http.Request) bool {
			origin := strings.ToLower(strings.TrimSpace(r.Header.Get("Origin")))
			return origin == "" || strings.HasPrefix(origin, "chrome-extension://") ||
				strings.HasPrefix(origin, "http://127.0.0.1") || strings.HasPrefix(origin, "http://localhost")
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	// 截图以 data URL 回传，给 4K 视口预留足够空间，同时仍限制异常大消息。
	conn.SetReadLimit(32 * 1024 * 1024)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var hello helloMessage
	if err := conn.ReadJSON(&hello); err != nil || hello.Type != "hello" || !b.TokenValid(hello.Token) {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "authentication failed"), time.Now().Add(time.Second))
		_ = conn.Close()
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	client := &clientConn{conn: conn, clientID: hello.ClientID, version: hello.Version, seenAt: time.Now()}
	if err := client.writeJSON(helloAck{Type: "hello_ack", AllowedDomains: b.allowedDomains}); err != nil {
		_ = conn.Close()
		return
	}
	b.attach(client)
	b.readLoop(client)
}

func (b *Broker) attach(client *clientConn) {
	b.mu.Lock()
	previous := b.client
	b.client = client
	b.mu.Unlock()
	if previous != nil && previous != client {
		_ = previous.conn.Close()
	}
}

func (b *Broker) readLoop(client *clientConn) {
	defer b.detach(client, "browser extension disconnected")
	for {
		var msg socketMessage
		if err := client.conn.ReadJSON(&msg); err != nil {
			return
		}
		b.mu.Lock()
		client.seenAt = time.Now()
		b.mu.Unlock()
		switch msg.Type {
		case "heartbeat":
			_ = client.writeJSON(socketMessage{Type: "heartbeat_ack"})
		case "result":
			b.resolve(client, Response{OK: msg.OK, TaskID: msg.TaskID, Data: msg.Data, Error: msg.Error, Code: msg.Code})
		}
	}
}

func (b *Broker) resolve(client *clientConn, result Response) {
	b.mu.Lock()
	pending, ok := b.pending[result.TaskID]
	if ok && pending.client == client {
		delete(b.pending, result.TaskID)
	}
	b.mu.Unlock()
	if ok && pending.client == client {
		select {
		case pending.result <- result:
		default:
		}
	}
}

func (b *Broker) detach(client *clientConn, reason string) {
	b.mu.Lock()
	if b.client == client {
		b.client = nil
	}
	failed := make([]pendingTask, 0)
	for taskID, pending := range b.pending {
		if pending.client == client {
			delete(b.pending, taskID)
			failed = append(failed, pending)
		}
	}
	b.mu.Unlock()
	_ = client.conn.Close()
	for _, pending := range failed {
		select {
		case pending.result <- Response{OK: false, Error: reason, Code: "BROWSER_DISCONNECTED"}:
		default:
		}
	}
}

func (b *Broker) Dispatch(ctx context.Context, req TaskRequest) Response {
	started := time.Now()
	normalized, err := NormalizeTask(req, b.allowedDomains)
	if err != nil {
		return Response{OK: false, TaskID: req.TaskID, Error: err.Error(), Code: "INVALID_TASK"}
	}
	b.mu.Lock()
	client := b.client
	if b.closed || client == nil {
		b.mu.Unlock()
		return Response{OK: false, TaskID: normalized.TaskID, Error: "browser extension is not connected", Code: "BROWSER_OFFLINE"}
	}
	if _, exists := b.pending[normalized.TaskID]; exists {
		b.mu.Unlock()
		return Response{OK: false, TaskID: normalized.TaskID, Error: "task_id already exists", Code: "DUPLICATE_TASK"}
	}
	resultCh := make(chan Response, 1)
	b.pending[normalized.TaskID] = pendingTask{client: client, result: resultCh}
	b.mu.Unlock()

	msg := socketMessage{Type: "task", TaskID: normalized.TaskID, Action: normalized.Action, TimeoutMS: normalized.TimeoutMS, Params: normalized.Params}
	if err := client.writeJSON(msg); err != nil {
		b.removePending(normalized.TaskID)
		return Response{OK: false, TaskID: normalized.TaskID, Error: "failed to send task to browser", Code: "BROWSER_WRITE_FAILED", DurationMS: time.Since(started).Milliseconds()}
	}
	timer := time.NewTimer(time.Duration(normalized.TimeoutMS) * time.Millisecond)
	defer timer.Stop()
	select {
	case result := <-resultCh:
		result.TaskID = normalized.TaskID
		result.DurationMS = time.Since(started).Milliseconds()
		return result
	case <-timer.C:
		b.removePending(normalized.TaskID)
		return Response{OK: false, TaskID: normalized.TaskID, Error: "browser task timed out", Code: "TASK_TIMEOUT", DurationMS: time.Since(started).Milliseconds()}
	case <-ctx.Done():
		b.removePending(normalized.TaskID)
		code := "REQUEST_CANCELLED"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = "TASK_TIMEOUT"
		}
		return Response{OK: false, TaskID: normalized.TaskID, Error: ctx.Err().Error(), Code: code, DurationMS: time.Since(started).Milliseconds()}
	}
}

func (b *Broker) removePending(taskID string) {
	b.mu.Lock()
	delete(b.pending, taskID)
	b.mu.Unlock()
}

func (b *Broker) Close() {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.closed = true
	client := b.client
	b.client = nil
	b.mu.Unlock()
	if client != nil {
		b.detach(client, "browser control stopped")
	}
}

func JSONData(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
