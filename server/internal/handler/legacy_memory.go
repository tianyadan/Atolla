package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

// AdminLegacyMemorySections GET /api/admin/legacy-memories/sections
func (h *Handler) AdminLegacyMemorySections(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"sections": service.LegacyMemorySectionCatalog()})
}

// AdminLegacyMemoryList GET /api/admin/legacy-memories
func (h *Handler) AdminLegacyMemoryList(c *gin.Context) {
	items, err := h.svc.ListLegacyMemoryShelf(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.LegacyMemory{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminLegacyMemoryGet GET /api/admin/legacy-memories/:id
func (h *Handler) AdminLegacyMemoryGet(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	m, err := h.svc.GetLegacyMemory(c.Request.Context(), id)
	if err != nil || m == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, m)
}

// AdminLegacyMemoryUpdate PATCH /api/admin/legacy-memories/:id
func (h *Handler) AdminLegacyMemoryUpdate(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		BodyMarkdown string `json:"body_markdown"`
		JobTitle     string `json:"job_title"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	m, err := h.svc.UpdateLegacyMemory(c.Request.Context(), id, body.BodyMarkdown, strings.TrimSpace(body.JobTitle))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

// AdminLegacyMemoryRetry POST /api/admin/legacy-memories/:id/retry
func (h *Handler) AdminLegacyMemoryRetry(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.svc.RetryLegacyMemoryGeneration(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminLegacyMemoryClaim POST /api/admin/legacy-memories/:id/claim
func (h *Handler) AdminLegacyMemoryClaim(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		AgentID int64 `json:"agent_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AgentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id required"})
		return
	}
	if err := h.svc.ClaimLegacyMemory(c.Request.Context(), id, body.AgentID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentLegacyMounts GET /api/admin/agents/:id/legacy-mounts
func (h *Handler) AdminAgentLegacyMounts(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	items, err := h.svc.ListAgentLegacyMounts(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "max": 5})
}

// AdminAgentsDismiss POST /api/admin/agents/:id/dismiss — async-friendly dismiss with memory option.
func (h *Handler) AdminAgentsDismiss(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body struct {
		KeepMemory bool     `json:"keep_memory"`
		Sections   []string `json:"sections"`
		JobTitle   string   `json:"job_title"`
	}
	_ = c.ShouldBindJSON(&body)
	mem, err := h.svc.DismissManaged(c.Request.Context(), id, service.DismissManagedInput{
		KeepMemory: body.KeepMemory,
		Sections:   body.Sections,
		JobTitle:   body.JobTitle,
	})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "legacy_memory": mem})
}
