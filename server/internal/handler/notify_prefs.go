package handler

import (
	"net/http"

	"atolla/server/internal/store"
	"github.com/gin-gonic/gin"
)

// AdminNotifyPrefsGet 返回完成通知与命令审批通知开关。
func (h *Handler) AdminNotifyPrefsGet(c *gin.Context) {
	prefs, err := h.svc.GetNotifyPrefs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, prefs)
}

// AdminNotifyPrefsPut 保存完成通知与命令审批通知开关。
func (h *Handler) AdminNotifyPrefsPut(c *gin.Context) {
	var body store.NotifyPrefs
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.SaveNotifyPrefs(c.Request.Context(), body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, body)
}
