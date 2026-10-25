package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AdminPickDirectory 弹出本机原生文件夹选择面板（macOS），供设置工作区使用。
func (h *Handler) AdminPickDirectory(c *gin.Context) {
	var body struct {
		Prompt string `json:"prompt"`
	}
	_ = c.ShouldBindJSON(&body)
	res, err := h.svc.PickDirectory(c.Request.Context(), body.Prompt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "os": res.OS})
		return
	}
	if res.Cancelled {
		c.JSON(http.StatusOK, gin.H{"cancelled": true, "os": res.OS})
		return
	}
	path := strings.TrimSpace(res.Path)
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未选择目录"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": path, "os": res.OS})
}
