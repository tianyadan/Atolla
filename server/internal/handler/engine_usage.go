package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/engineusage"
)

// AdminEnginesUsage GET /api/admin/engines/usage — 三个工作引擎订阅配额（只读聚合，默认 5 分钟缓存）。
// Query fresh=1|true 时强制刷新。
func (h *Handler) AdminEnginesUsage(c *gin.Context) {
	fresh := c.Query("fresh")
	force := fresh == "1" || fresh == "true" || fresh == "yes"
	c.JSON(http.StatusOK, engineusage.FetchAll(c.Request.Context(), force))
}
