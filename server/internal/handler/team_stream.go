package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/teamstream"
)

const teamStreamHeartbeat = 15 * time.Second

// TeamStream GET /api/teams/:teamId/stream — 水母工作组 SSE。
// teamId 对应 agent_folders.id；0 表示未入组员工。
// 支持 Last-Event-ID 断线补发；缺口时重推 snapshot。
func (h *Handler) TeamStream(c *gin.Context) {
	teamID, err := strconv.ParseInt(c.Param("teamId"), 10, 64)
	if err != nil || teamID < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid teamId"})
		return
	}
	ctx := c.Request.Context()
	if err := h.svc.EnsureTeamExists(ctx, teamID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if h.svc.TeamHub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "team stream unavailable"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	writePayload := func(ev teamstream.Event) {
		b, _ := json.Marshal(ev.Payload)
		_, _ = fmt.Fprintf(c.Writer, "id: %d\ndata: %s\n\n", ev.Seq, b)
		flusher.Flush()
	}

	// 先订阅，再 snapshot/replay，避免中间丢事件；用 maxSeq 去重。
	sub := h.svc.TeamHub.Subscribe(teamID)
	defer h.svc.TeamHub.Unsubscribe(teamID, sub)

	var maxSeq int64
	lastID := parseLastEventID(c)
	sendSnapshot := true
	if lastID > 0 {
		missed, okReplay := h.svc.TeamHub.ReplayAfter(teamID, lastID)
		if okReplay {
			sendSnapshot = false
			for _, ev := range missed {
				writePayload(ev)
				if ev.Seq > maxSeq {
					maxSeq = ev.Seq
				}
			}
		}
	}
	if sendSnapshot {
		snap, err := h.svc.BuildTeamSnapshot(ctx, teamID)
		if err != nil {
			_, _ = fmt.Fprintf(c.Writer, "event: error\ndata: {\"error\":%q}\n\n", err.Error())
			flusher.Flush()
			return
		}
		fields := map[string]any{}
		for k, v := range snap {
			if k == "type" {
				continue
			}
			fields[k] = v
		}
		ev := h.svc.TeamHub.Publish(teamID, "snapshot", fields)
		writePayload(ev)
		maxSeq = ev.Seq
	}

	ticker := time.NewTicker(teamStreamHeartbeat)
	defer ticker.Stop()
	clientGone := c.Request.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case <-ticker.C:
			// SSE 注释心跳，不计入 seq
			_, _ = fmt.Fprintf(c.Writer, ": ping %d\n\n", time.Now().Unix())
			flusher.Flush()
		case ev, open := <-sub:
			if !open {
				return
			}
			if ev.Seq <= maxSeq {
				continue
			}
			writePayload(ev)
			maxSeq = ev.Seq
		}
	}
}

// parseLastEventID 读取 Last-Event-ID 头（也兼容 query lastEventId）。
func parseLastEventID(c *gin.Context) int64 {
	raw := strings.TrimSpace(c.GetHeader("Last-Event-ID"))
	if raw == "" {
		raw = strings.TrimSpace(c.Query("lastEventId"))
	}
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}
