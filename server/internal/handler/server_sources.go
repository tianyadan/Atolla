package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/store"
)

// AdminAgentServerSourcesList GET /api/admin/agents/:id/server-sources
func (h *Handler) AdminAgentServerSourcesList(c *gin.Context) {
	id, err := parseAgentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	items, err := h.svc.ListAgentServerSources(c.Request.Context(), id)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "install server control") {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.ServerSource{}
	}
	c.JSON(http.StatusOK, gin.H{"sources": items})
}

// AdminAgentServerSourcesCreate POST /api/admin/agents/:id/server-sources
func (h *Handler) AdminAgentServerSourcesCreate(c *gin.Context) {
	id, err := parseAgentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body store.ServerSourceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	autoTest := true
	if v := c.Query("test"); v == "0" {
		autoTest = false
	}
	src, err := h.svc.CreateAgentServerSource(c.Request.Context(), id, body, autoTest)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

// AdminAgentServerSourcesUpdate PATCH /api/admin/agents/:id/server-sources/:sourceId
func (h *Handler) AdminAgentServerSourcesUpdate(c *gin.Context) {
	id, err := parseAgentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	sid, err := parseSourceID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad sourceId"})
		return
	}
	var body store.ServerSourceInput
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	src, err := h.svc.UpdateAgentServerSource(c.Request.Context(), id, sid, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

// AdminAgentServerSourcesDelete DELETE /api/admin/agents/:id/server-sources/:sourceId
func (h *Handler) AdminAgentServerSourcesDelete(c *gin.Context) {
	id, err := parseAgentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	sid, err := parseSourceID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad sourceId"})
		return
	}
	if err := h.svc.DeleteAgentServerSource(c.Request.Context(), id, sid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentServerSourcesTest POST /api/admin/agents/:id/server-sources/:sourceId/test
func (h *Handler) AdminAgentServerSourcesTest(c *gin.Context) {
	id, err := parseAgentID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	sid, err := parseSourceID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad sourceId"})
		return
	}
	src, err := h.svc.TestAgentServerSource(c.Request.Context(), id, sid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

func parseAgentID(c *gin.Context) (int64, error) {
	return strconv.ParseInt(c.Param("id"), 10, 64)
}

func parseSourceID(c *gin.Context) (int64, error) {
	return strconv.ParseInt(c.Param("sourceId"), 10, 64)
}
