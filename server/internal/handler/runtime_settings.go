package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// AdminRuntimeSettingsGet GET /api/admin/runtime-settings
func (h *Handler) AdminRuntimeSettingsGet(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.GetRuntimeSettings())
}

// AdminRuntimeSettingsPut PUT /api/admin/runtime-settings
func (h *Handler) AdminRuntimeSettingsPut(c *gin.Context) {
	var body service.RuntimeSettings
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.SaveRuntimeSettings(c.Request.Context(), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": out, "restart_required": true})
}

// AdminRuntimeRestart POST /api/admin/runtime-settings/restart
func (h *Handler) AdminRuntimeRestart(c *gin.Context) {
	if err := h.svc.RestartRuntime(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"restart": "pending", "message": "Atolla 正在重启"})
}
