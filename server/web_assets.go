package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// registerWebApp 为桌面发行包托管 Vite 产物。API 先由 Handler 注册；这里仅接管未命中的
// 页面请求，避免 SPA fallback 吞掉错误的 API 路径并把问题伪装成成功页面。
func registerWebApp(router *gin.Engine, webDir string) {
	webDir = strings.TrimSpace(webDir)
	if webDir == "" {
		return
	}

	indexPath := filepath.Join(webDir, "index.html")
	if info, err := os.Stat(indexPath); err != nil || info.IsDir() {
		return
	}

	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusNotFound)
			return
		}
		if isBackendPath(c.Request.URL.Path) {
			c.Status(http.StatusNotFound)
			return
		}

		assetPath := filepath.Join(webDir, filepath.FromSlash(strings.TrimPrefix(path.Clean("/"+c.Request.URL.Path), "/")))
		if info, err := os.Stat(assetPath); err == nil && !info.IsDir() {
			if strings.HasPrefix(c.Request.URL.Path, "/assets/") {
				// Vite 资源名带内容哈希；长期缓存不会让新版页面引用旧资源。
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				c.Header("Cache-Control", "no-cache")
			}
			c.File(assetPath)
			return
		}
		// HTML 入口不能长期缓存，否则桌面升级后可能加载旧资源清单。
		c.Header("Cache-Control", "no-cache")
		c.File(indexPath)
	})
}

func isBackendPath(requestPath string) bool {
	return requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") ||
		requestPath == "/health" || strings.HasPrefix(requestPath, "/internal/")
}
