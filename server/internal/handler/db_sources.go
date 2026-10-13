package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

// AdminDBClients GET /api/admin/db-clients?type=mysql — 按类型检测本机客户端
func (h *Handler) AdminDBClients(c *gin.Context) {
	dbType := strings.TrimSpace(c.Query("type"))
	if dbType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type required"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clients": h.svc.ListDBClients(dbType), "types": service.SupportedDBTypes()})
}

// AdminAgentDBSourcesList GET /api/admin/agents/:id/db-sources
func (h *Handler) AdminAgentDBSourcesList(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	items, err := h.svc.ListAgentDBSources(c.Request.Context(), id)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "install database skill") {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.DBSource{}
	}
	c.JSON(http.StatusOK, gin.H{"sources": items})
}

// AdminAgentDBSourcesCreate POST /api/admin/agents/:id/db-sources
func (h *Handler) AdminAgentDBSourcesCreate(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body store.DBSourceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	src, err := h.svc.CreateAgentDBSource(c.Request.Context(), id, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

// AdminAgentDBSourcesUpdate PATCH /api/admin/agents/:id/db-sources/:sourceId
func (h *Handler) AdminAgentDBSourcesUpdate(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	sid, err := strconv.ParseInt(c.Param("sourceId"), 10, 64)
	if err != nil || sid <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad sourceId"})
		return
	}
	var body store.DBSourceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	src, err := h.svc.UpdateAgentDBSource(c.Request.Context(), id, sid, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

// AdminAgentDBSourcesDelete DELETE /api/admin/agents/:id/db-sources/:sourceId
func (h *Handler) AdminAgentDBSourcesDelete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	sid, err := strconv.ParseInt(c.Param("sourceId"), 10, 64)
	if err != nil || sid <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad sourceId"})
		return
	}
	if err := h.svc.DeleteAgentDBSource(c.Request.Context(), id, sid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
