package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// AdminRemoteRelayConfigGet GET /api/admin/remote-relay/config
func (h *Handler) AdminRemoteRelayConfigGet(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.GetRemoteRelayConfig())
}

// AdminRemoteRelayConfigPut PUT /api/admin/remote-relay/config
func (h *Handler) AdminRemoteRelayConfigPut(c *gin.Context) {
	var body service.RemoteRelayConfigUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpdateRemoteRelayConfig(c.Request.Context(), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// AdminRemoteRelaySMTPTest POST /api/admin/remote-relay/smtp/test
func (h *Handler) AdminRemoteRelaySMTPTest(c *gin.Context) {
	out, err := h.svc.TestRemoteRelaySMTP(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "config": out})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "config": out})
}

// AdminRemoteRelayPasswordRotate POST /api/admin/remote-relay/password/rotate
func (h *Handler) AdminRemoteRelayPasswordRotate(c *gin.Context) {
	plain, err := h.svc.RotateRemoteRelayPassword(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"password": plain})
}

// AdminRemoteRelayStatus GET /api/admin/remote-relay/status
func (h *Handler) AdminRemoteRelayStatus(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.GetRemoteRelayStatus())
}

// AdminRemoteRelayMobileSessionsGet GET /api/admin/remote-relay/mobile-sessions
func (h *Handler) AdminRemoteRelayMobileSessionsGet(c *gin.Context) {
	sessions, err := h.svc.ListRemoteRelayMobileSessions(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

// AdminRemoteRelayMobileSessionKick DELETE /api/admin/remote-relay/mobile-sessions/:sessionId
func (h *Handler) AdminRemoteRelayMobileSessionKick(c *gin.Context) {
	sid := strings.TrimSpace(c.Param("sessionId"))
	if sid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	if err := h.svc.KickRemoteRelayMobileSession(c.Request.Context(), sid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminRemoteRelayDeploy POST /api/admin/remote-relay/deploy — start one-click install job.
func (h *Handler) AdminRemoteRelayDeploy(c *gin.Context) {
	var body service.RemoteRelayDeployRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.StartRemoteRelayDeploy(body)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "another deploy/upgrade job is running" {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"job_id": id})
}

// AdminRemoteRelayUpgrade POST /api/admin/remote-relay/upgrade — start one-click upgrade job.
func (h *Handler) AdminRemoteRelayUpgrade(c *gin.Context) {
	var body service.RemoteRelayUpgradeRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.StartRemoteRelayUpgrade(body)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "another deploy/upgrade job is running" {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"job_id": id})
}

// AdminRemoteRelayDeployJobStream GET /api/admin/remote-relay/deploy-job/:id/stream — SSE logs.
func (h *Handler) AdminRemoteRelayDeployJobStream(c *gin.Context) {
	id := c.Param("id")
	lines, ch, done, ok, errMsg, err := h.svc.SubscribeRemoteRelayDeployJob(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	flusher, okf := c.Writer.(http.Flusher)
	if !okf {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	writeEvent := func(ev string, payload any) {
		b, _ := json.Marshal(payload)
		_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", ev, b)
		flusher.Flush()
	}

	for _, line := range lines {
		writeEvent("log", gin.H{"line": line})
	}
	if done {
		if ok {
			writeEvent("done", gin.H{"ok": true})
		} else {
			writeEvent("error", gin.H{"error": errMsg})
		}
		return
	}
	defer h.svc.UnsubscribeRemoteRelayDeployJob(id, ch)

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	clientGone := c.Request.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case <-ticker.C:
			writeEvent("ping", gin.H{"ts": time.Now().Unix()})
		case line, open := <-ch:
			if !open {
				_, dok, derr, _ := h.svc.SnapshotRemoteRelayDeployJob(id)
				if dok {
					writeEvent("done", gin.H{"ok": true})
				} else {
					writeEvent("error", gin.H{"error": derr})
				}
				return
			}
			writeEvent("log", gin.H{"line": line})
		}
	}
}
