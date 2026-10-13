package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// AdminTalentMarketList GET /api/admin/talent-market
func (h *Handler) AdminTalentMarketList(c *gin.Context) {
	items, err := h.svc.ListTalentMarket(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []service.TalentCard{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminTalentMarketGet GET /api/admin/talent-market/:id
func (h *Handler) AdminTalentMarketGet(c *gin.Context) {
	item, err := h.svc.GetTalentMarketItem(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "talent not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

// AdminTalentMarketHire POST /api/admin/talent-market/hire
func (h *Handler) AdminTalentMarketHire(c *gin.Context) {
	var body struct {
		TalentID            string `json:"talent_id"`
		Name                string `json:"name"`
		Engine              string `json:"engine"`
		ContextWindowTokens *int64 `json:"context_window_tokens"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.TalentID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "talent_id required"})
		return
	}
	a, err := h.svc.HireTalent(c.Request.Context(), service.HireTalentInput{
		TalentID:            strings.TrimSpace(body.TalentID),
		Name:                strings.TrimSpace(body.Name),
		Engine:              strings.TrimSpace(body.Engine),
		ContextWindowTokens: body.ContextWindowTokens,
	})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}
