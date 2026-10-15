package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminNetworkAllowlistGet returns current domain allowlist.
func (h *Handler) AdminNetworkAllowlistGet(c *gin.Context) {
	rows, err := h.svc.Store.ListNetworkAllowlist(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": rows})
}

// AdminNetworkAllowlistPut replaces allowlist and syncs home CLI configs.
func (h *Handler) AdminNetworkAllowlistPut(c *gin.Context) {
	var body struct {
		Patterns []string `json:"patterns"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	syncRes, err := h.svc.ReplaceNetworkAllowlistAndSync(c.Request.Context(), body.Patterns)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rows, _ := h.svc.Store.ListNetworkAllowlist(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"items": rows, "sync": syncRes})
}

// AdminNetworkAllowlistSync forces rewrite of Cursor/Claude/Codex home configs.
func (h *Handler) AdminNetworkAllowlistSync(c *gin.Context) {
	syncRes := h.svc.SyncNetworkAllowlistToHome(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"sync": syncRes})
}
