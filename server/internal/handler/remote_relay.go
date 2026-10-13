package handler

import (
	"net/http"

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
