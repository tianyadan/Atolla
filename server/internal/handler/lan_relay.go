package handler

import (
	"database/sql"
	"net/http"
	"strings"

	"atolla/server/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *Handler) AdminLanRelayConfigGet(c *gin.Context) {
	out, err := h.svc.GetLanRelayConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}
func (h *Handler) AdminLanRelayConfigPut(c *gin.Context) {
	var body service.LanRelayConfigUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpdateLanRelayConfig(c.Request.Context(), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ApplyLanRelayConfig(c.Request.Context()); err != nil {
		// 配置已持久化，保留它便于用户改正端口后重试；不能把“已启用”误报成监听成功。
		c.JSON(http.StatusConflict, gin.H{"error": "局域网服务未能启动: " + err.Error(), "config": out})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) AdminLanRelayStatus(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.LanRelayStatus())
}
func (h *Handler) AdminLanRelayDevices(c *gin.Context) {
	out, err := h.svc.ListLanRelayDevices(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"devices": out})
}
func (h *Handler) AdminLanRelayAudits(c *gin.Context) {
	out, err := h.svc.ListLanRelayAudits(c.Request.Context(), 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}
func (h *Handler) AdminLanRelayPair(c *gin.Context) {
	var body service.LanRelayPairDeviceRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.PairLanRelayDevice(c.Request.Context(), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}
func (h *Handler) AdminLanRelayPairStatus(c *gin.Context) {
	out, err := h.svc.GetLanRelayPairStatus(c.Request.Context(), c.Param("id"))
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "pairing session not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// AdminLanRelayDevicesRevoke revokes every credential behind one logical phone
// card, so a phone that paired several times disappears in one action.
func (h *Handler) AdminLanRelayDevicesRevoke(c *gin.Context) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids must contain 1-50 device ids"})
		return
	}
	revoked, err := h.svc.RevokeLanRelayDevices(c.Request.Context(), body.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "revoked": revoked})
}

func (h *Handler) AdminLanRelayDeviceRevoke(c *gin.Context) {
	if err := h.svc.RevokeLanRelayDevice(c.Request.Context(), strings.TrimSpace(c.Param("id"))); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "device not found or already revoked"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
