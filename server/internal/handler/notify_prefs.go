package handler

import (
	"net/http"
	"strings"

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
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "Bark 验证") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	prefs, err := h.svc.GetNotifyPrefs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusOK, body)
		return
	}
	c.JSON(http.StatusOK, prefs)
}

// AdminNotifyBarkVerifySend 向 Bark 发送 6 位验证码。
func (h *Handler) AdminNotifyBarkVerifySend(c *gin.Context) {
	expiresIn, err := h.svc.SendNotifyBarkOTP(c.Request.Context())
	if err != nil {
		status := http.StatusBadRequest
		msg := err.Error()
		if strings.Contains(msg, "过于频繁") {
			status = http.StatusTooManyRequests
		} else if strings.Contains(msg, "暂不可用") {
			status = http.StatusInternalServerError
		}
		c.JSON(status, gin.H{"error": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "expires_in": expiresIn})
}

// AdminNotifyBarkVerifyConfirm 校验 Bark 验证码并标记已验证。
func (h *Handler) AdminNotifyBarkVerifyConfirm(c *gin.Context) {
	var body struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.ConfirmNotifyBarkOTP(c.Request.Context(), body.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	prefs, err := h.svc.GetNotifyPrefs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "bark_verified": true})
		return
	}
	c.JSON(http.StatusOK, prefs)
}
