package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// AdminWatchdogLocalGet GET /api/admin/watchdog/local
func (h *Handler) AdminWatchdogLocalGet(c *gin.Context) {
	st, err := h.svc.GetLocalWatchdogStatus()
	if err != nil {
		c.JSON(http.StatusOK, st) // 仍返回结构化状态，便于 UI 展示 detail
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminWatchdogLocalPut PUT /api/admin/watchdog/local
func (h *Handler) AdminWatchdogLocalPut(c *gin.Context) {
	var body service.LocalWatchdogPut
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st, err := h.svc.SetLocalWatchdog(body.Enabled)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "enabled": st.Enabled, "status": st.Status, "detail": st.Detail, "grace_sec": st.GraceSec})
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminWatchdogRelayGet GET /api/admin/watchdog/relay
func (h *Handler) AdminWatchdogRelayGet(c *gin.Context) {
	st, target, err := h.svc.GetRelayWatchdogStatus()
	payload := gin.H{
		"enabled":     st.Enabled,
		"status":      st.Status,
		"detail":      st.Detail,
		"grace_sec":   st.GraceSec,
		"host":        target.Host,
		"user":        target.User,
		"ssh_port":    target.SSHPort,
		"remote_dir":  target.RemoteDir,
		"listen_port": target.ListenPort,
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	c.JSON(http.StatusOK, payload)
}

// AdminWatchdogRelayPut PUT /api/admin/watchdog/relay
func (h *Handler) AdminWatchdogRelayPut(c *gin.Context) {
	var body service.RelayWatchdogPut
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st, target, err := h.svc.SetRelayWatchdog(body)
	payload := gin.H{
		"enabled":     st.Enabled,
		"status":      st.Status,
		"detail":      st.Detail,
		"grace_sec":   st.GraceSec,
		"host":        target.Host,
		"user":        target.User,
		"ssh_port":    target.SSHPort,
		"remote_dir":  target.RemoteDir,
		"listen_port": target.ListenPort,
	}
	if err != nil {
		payload["error"] = err.Error()
		c.JSON(http.StatusBadRequest, payload)
		return
	}
	c.JSON(http.StatusOK, payload)
}
