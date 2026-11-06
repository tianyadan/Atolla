package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"atolla/server/internal/browsercontrol"
	"atolla/server/internal/service"
)

func TestBrowserControlHTTPAndWebSocket(t *testing.T) {
	gin.SetMode(gin.TestMode)
	broker := browsercontrol.New("browser-token", []string{"localhost", "127.0.0.1"}, false)
	t.Cleanup(broker.Close)
	h := &Handler{svc: &service.Service{Browser: broker}}
	router := gin.New()
	group := router.Group("/api/browser")
	group.Use(h.requireBrowserLocal())
	group.GET("/ws", h.BrowserControlWebSocket)
	authed := group.Group("")
	authed.Use(h.requireBrowserToken())
	authed.GET("/status", h.BrowserControlStatus)
	authed.POST("/tasks", h.BrowserControlTask)

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	unauthorized, err := http.Get(server.URL + "/api/browser/status")
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status without token=%d, want 401", unauthorized.StatusCode)
	}

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/api/browser/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.WriteJSON(map[string]any{"type": "hello", "token": "browser-token", "client_id": "handler-test"}); err != nil {
		t.Fatal(err)
	}
	var ack map[string]any
	if err := conn.ReadJSON(&ack); err != nil || ack["type"] != "hello_ack" {
		t.Fatalf("ack=%v err=%v", ack, err)
	}

	go func() {
		var task map[string]any
		if err := conn.ReadJSON(&task); err != nil {
			return
		}
		_ = conn.WriteJSON(map[string]any{
			"type": "result", "task_id": task["task_id"], "ok": true,
			"data": map[string]any{"tabs": []any{map[string]any{"id": 7}}},
		})
	}()

	body := bytes.NewBufferString(`{"task_id":"http-task-1","action":"tabs.list","params":{}}`)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/browser/tasks", body)
	req.Header.Set("Authorization", "Bearer browser-token")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var result browsercontrol.Response
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || !result.OK || result.TaskID != "http-task-1" || !strings.Contains(string(result.Data), `"id":7`) {
		t.Fatalf("status=%d result=%+v", resp.StatusCode, result)
	}
}
