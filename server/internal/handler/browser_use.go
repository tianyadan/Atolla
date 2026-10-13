package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminBrowserUseStatus GET /api/admin/browser-use
func (h *Handler) AdminBrowserUseStatus(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.ListBrowserUseStatus())
}

// AdminBrowserUseEnsure POST /api/admin/browser-use/ensure — 检测并尝试安装
func (h *Handler) AdminBrowserUseEnsure(c *gin.Context) {
	st, err := h.svc.EnsureBrowserUse(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "status": st})
		return
	}
	c.JSON(http.StatusOK, st)
}
