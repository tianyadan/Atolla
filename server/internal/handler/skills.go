package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/store"
)

// AdminSkillStoreList GET /api/admin/skills/store
func (h *Handler) AdminSkillStoreList(c *gin.Context) {
	items, err := h.svc.ListSkillStore(c.Request.Context(), c.Query("q"), c.Query("category"), c.Query("risk"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.SkillCatalogItem{}
	}
	c.JSON(http.StatusOK, gin.H{"skills": items})
}

// AdminSkillStoreGet GET /api/admin/skills/store/:id
func (h *Handler) AdminSkillStoreGet(c *gin.Context) {
	item, err := h.svc.GetSkillStoreItem(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

// AdminSkillCustomPublish POST /api/admin/skills/custom
func (h *Handler) AdminSkillCustomPublish(c *gin.Context) {
	var body store.SkillCatalogItem
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.PublisherName == "" {
		body.PublisherName = "admin"
	}
	item, err := h.svc.PublishCustomSkill(c.Request.Context(), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// AdminAgentSkillsList GET /api/admin/agents/:id/skills
func (h *Handler) AdminAgentSkillsList(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	items, err := h.svc.ListAgentSkills(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.AgentSkillView{}
	}
	c.JSON(http.StatusOK, gin.H{"skills": items})
}

// AdminAgentSkillsInstall POST /api/admin/agents/:id/skills/install
func (h *Handler) AdminAgentSkillsInstall(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body struct {
		SkillID      string   `json:"skill_id"`
		Capabilities []string `json:"capabilities"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.SkillID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill_id required"})
		return
	}
	items, err := h.svc.InstallAgentSkill(c.Request.Context(), id, strings.TrimSpace(body.SkillID), "admin", body.Capabilities)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"skills": items})
}

// AdminAgentSkillsUpdate PATCH /api/admin/agents/:id/skills/:skillId
func (h *Handler) AdminAgentSkillsUpdate(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	skillID := strings.TrimSpace(c.Param("skillId"))
	if skillID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skillId required"})
		return
	}
	var body struct {
		Enabled      *bool    `json:"enabled"`
		Capabilities []string `json:"capabilities"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	items, err := h.svc.UpdateAgentSkill(c.Request.Context(), id, skillID, body.Enabled, body.Capabilities)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "no rows") {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"skills": items})
}

// AdminAgentSkillsUninstall DELETE /api/admin/agents/:id/skills/:skillId
func (h *Handler) AdminAgentSkillsUninstall(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	skillID := strings.TrimSpace(c.Param("skillId"))
	if skillID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skillId required"})
		return
	}
	items, err := h.svc.UninstallAgentSkill(c.Request.Context(), id, skillID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"skills": items})
}
