package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/browsercontrol"
)

func (h *Handler) requireBrowserLocal() gin.HandlerFunc {
	return func(c *gin.Context) {
		if h.svc.Browser == nil || !h.svc.Browser.AllowRequest(c.Request.RemoteAddr) {
			c.AbortWithStatusJSON(http.StatusForbidden, browsercontrol.Response{OK: false, Error: "browser control only accepts local clients", Code: "LOCAL_ONLY"})
			return
		}
		c.Next()
	}
}

func (h *Handler) requireBrowserToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(header, "Bearer ") || h.svc.Browser == nil || !h.svc.Browser.TokenValid(strings.TrimSpace(header[7:])) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, browsercontrol.Response{OK: false, Error: "invalid browser control token", Code: "UNAUTHORIZED"})
			return
		}
		c.Next()
	}
}

// BrowserControlStatus 返回扩展连接、白名单和等待任务状态。
func (h *Handler) BrowserControlStatus(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.Browser.Status())
}

// BrowserControlTask 将固定动作通过 WebSocket 派发到 Chrome MV3 扩展。
func (h *Handler) BrowserControlTask(c *gin.Context) {
	var req browsercontrol.TaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, browsercontrol.Response{OK: false, Error: "invalid JSON body", Code: "INVALID_JSON"})
		return
	}
	result := h.svc.Browser.Dispatch(c.Request.Context(), req)
	status := http.StatusOK
	if !result.OK {
		switch result.Code {
		case "INVALID_TASK", "DUPLICATE_TASK":
			status = http.StatusBadRequest
		case "BROWSER_OFFLINE", "BROWSER_DISCONNECTED", "BROWSER_WRITE_FAILED":
			status = http.StatusServiceUnavailable
		case "TASK_TIMEOUT":
			status = http.StatusGatewayTimeout
		default:
			status = http.StatusUnprocessableEntity
		}
	}
	c.JSON(status, result)
}

// BrowserControlWebSocket 接收扩展连接；Token 在升级后的首个 hello 消息中校验。
func (h *Handler) BrowserControlWebSocket(c *gin.Context) {
	h.svc.Browser.ServeWebSocket(c.Writer, c.Request)
}
