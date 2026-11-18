package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/store"
)

// AdminEngineModelsGet GET /api/admin/engines/:engine/models — 引擎可选模型目录。
func (h *Handler) AdminEngineModelsGet(c *gin.Context) {
	engine := store.RepairEngineName(c.Param("engine"))
	if !store.ValidEngine(engine) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "engine must be claude|codex|agent"})
		return
	}
	cat := h.svc.ListEngineModels(c.Request.Context(), engine)
	c.JSON(http.StatusOK, cat)
}
