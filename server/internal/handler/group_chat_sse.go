package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// groupChatSSE 打开群聊 SSE，转发同 conversation 的授权事件，并跑 run。
func (h *Handler) groupChatSSE(c *gin.Context, groupConv int64, run func(send func(any), onEvent service.AskEventSink) error) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	var wmu sync.Mutex
	sendEvent := func(payload any) {
		wmu.Lock()
		defer wmu.Unlock()
		b, _ := json.Marshal(payload)
		_, _ = c.Writer.Write([]byte("data: " + string(b) + "\n\n"))
		flusher.Flush()
	}

	if h.svc.Perms != nil {
		sub := h.svc.Perms.Subscribe()
		defer h.svc.Perms.Unsubscribe(sub)
		done := make(chan struct{})
		var fwd sync.WaitGroup
		fwd.Add(1)
		go func() {
			defer fwd.Done()
			for {
				select {
				case <-done:
					return
				case ev := <-sub:
					var payload map[string]interface{}
					if (ev.Kind == "request" || ev.Kind == "auto") && ev.Req != nil {
						if ev.Req.ConvID != groupConv {
							continue
						}
						typ := "permission_request"
						if ev.Kind == "auto" {
							typ = "permission_auto"
						}
						payload = map[string]interface{}{
							"type": typ, "request_id": ev.Req.ID, "tool_name": ev.Req.ToolName,
							"summary": ev.Req.Summary, "deadline": ev.Req.Deadline, "note": ev.Req.Note,
							"meaning": ev.Req.Meaning, "risk": ev.Req.Risk, "conversation_id": groupConv,
						}
					} else if ev.Kind == "command" && ev.Req != nil {
						if ev.Req.ConvID == 0 || ev.Req.ConvID != groupConv {
							continue
						}
						payload = map[string]interface{}{
							"type": "command", "tool_name": ev.Req.ToolName, "summary": ev.Req.Summary,
							"decision": ev.Req.Decision, "decided_by": ev.Req.DecidedBy,
							"risk": ev.Req.Risk, "meaning": ev.Req.Meaning,
						}
					} else if ev.Kind == "resolved" && ev.Res != nil {
						payload = map[string]interface{}{"type": "permission_resolved", "request_id": ev.Res.ID, "behavior": ev.Res.Behavior, "by": ev.Res.By}
					} else {
						continue
					}
					sendEvent(payload)
				}
			}
		}()
		var stopOnce sync.Once
		stopForward := func() {
			stopOnce.Do(func() { close(done); fwd.Wait() })
		}
		defer stopForward()

		onEvent := func(ev map[string]any) {
			if ev == nil {
				return
			}
			if t, _ := ev["type"].(string); t == "chunk" {
				if c, ok := ev["content"].(string); ok {
					ev["content"] = strings.ReplaceAll(c, "\n", "\\n")
				}
			}
			sendEvent(ev)
		}
		if err := run(sendEvent, onEvent); err != nil {
			sendEvent(map[string]interface{}{"type": "error", "message": err.Error()})
		}
		stopForward()
		return
	}

	onEvent := func(ev map[string]any) {
		if ev == nil {
			return
		}
		if t, _ := ev["type"].(string); t == "chunk" {
			if c, ok := ev["content"].(string); ok {
				ev["content"] = strings.ReplaceAll(c, "\n", "\\n")
			}
		}
		sendEvent(ev)
	}
	if err := run(sendEvent, onEvent); err != nil {
		sendEvent(map[string]interface{}{"type": "error", "message": err.Error()})
	}
}
