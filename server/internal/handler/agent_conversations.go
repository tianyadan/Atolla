package handler

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

func (h *Handler) AdminAgentConversationsList(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	includeArchived := c.Query("include_archived") == "1" || c.Query("include_archived") == "true"
	items, err := h.svc.ListAgentConversations(c.Request.Context(), limit, includeArchived)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.AgentConversationSummary{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminAgentConversationCreate(c *gin.Context) {
	agentID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if agentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if c.Request.ContentLength > 0 && c.ShouldBindJSON(&body) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	item, err := h.svc.CreateAgentConversationThread(c.Request.Context(), agentID, body.Title)
	if err != nil {
		writeAgentConversationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": item})
}

func (h *Handler) AdminAgentConversationActivate(c *gin.Context) {
	agentID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	conversationID, _ := strconv.ParseInt(c.Param("conversationId"), 10, 64)
	if agentID <= 0 || conversationID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := h.svc.ActivateAgentConversationThread(c.Request.Context(), agentID, conversationID); err != nil {
		writeAgentConversationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) AdminAgentConversationUpdate(c *gin.Context) {
	conversationID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if conversationID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body struct {
		Title    *string `json:"title"`
		Pinned   *bool   `json:"pinned"`
		Archived *bool   `json:"archived"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	err := h.svc.UpdateAgentConversationThread(c.Request.Context(), conversationID, store.AgentConversationPatch{
		Title: body.Title, Pinned: body.Pinned, Archived: body.Archived,
	})
	if err != nil {
		writeAgentConversationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func writeAgentConversationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAgentConversationBusy):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, sql.ErrNoRows):
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
	case err.Error() == "agent not found":
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}
