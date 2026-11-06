package browsercontrol

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func connectTestExtension(t *testing.T, broker *Broker, token string) (*websocket.Conn, helloAck) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(broker.ServeWebSocket))
	t.Cleanup(server.Close)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.WriteJSON(helloMessage{Type: "hello", Token: token, ClientID: "test-extension", Version: "0.1.0"}); err != nil {
		t.Fatal(err)
	}
	var ack helloAck
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatal(err)
	}
	return conn, ack
}

func TestBrokerDispatchesTaskAndReturnsResult(t *testing.T) {
	broker := New("test-token", []string{"localhost", "127.0.0.1"}, false)
	t.Cleanup(broker.Close)
	conn, ack := connectTestExtension(t, broker, "test-token")
	if ack.Type != "hello_ack" || len(ack.AllowedDomains) != 2 {
		t.Fatalf("unexpected ack: %+v", ack)
	}

	go func() {
		var task socketMessage
		if err := conn.ReadJSON(&task); err != nil {
			return
		}
		_ = conn.WriteJSON(socketMessage{
			Type:   "result",
			TaskID: task.TaskID,
			OK:     true,
			Data:   json.RawMessage(`{"tabs":[{"id":1}]}`),
		})
	}()

	result := broker.Dispatch(context.Background(), TaskRequest{Action: "tabs.list", TimeoutMS: 1000})
	if !result.OK || result.TaskID == "" || !strings.Contains(string(result.Data), `"id":1`) {
		t.Fatalf("unexpected result: %+v", result)
	}
	status := broker.Status()
	if !status.Connected || status.ClientID != "test-extension" || status.PendingTasks != 0 {
		t.Fatalf("unexpected status: %+v", status)
	}
}

func TestBrokerTaskTimeout(t *testing.T) {
	broker := New("test-token", nil, false)
	t.Cleanup(broker.Close)
	_, _ = connectTestExtension(t, broker, "test-token")
	result := broker.Dispatch(context.Background(), TaskRequest{Action: "tabs.list", TimeoutMS: 100})
	if result.OK || result.Code != "TASK_TIMEOUT" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.DurationMS < int64((50 * time.Millisecond).Milliseconds()) {
		t.Fatalf("timeout returned too quickly: %+v", result)
	}
}

func TestBrokerRejectsRemoteAddressAndBadToken(t *testing.T) {
	broker := New("secret", nil, false)
	if broker.AllowRequest("192.168.1.10:1234") {
		t.Fatal("remote address must be rejected by default")
	}
	if !broker.AllowRequest("127.0.0.1:1234") {
		t.Fatal("loopback address must be allowed")
	}
	if broker.TokenValid("wrong") || !broker.TokenValid("secret") {
		t.Fatal("unexpected token validation result")
	}
}
