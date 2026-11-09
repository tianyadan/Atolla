package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"atolla/server/internal/service"
	"github.com/gin-gonic/gin"
)

// AdminIOSAppInfo GET /api/admin/ios-app/info — App 版本与真机构建环境。
func (h *Handler) AdminIOSAppInfo(c *gin.Context) {
	info, err := h.svc.GetIOSAppInfo()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, info)
}

// AdminIOSAppBuildHistory GET /api/admin/ios-app/builds — 近期构建记录。
func (h *Handler) AdminIOSAppBuildHistory(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"items": h.svc.ListIOSAppBuildHistory()})
}

// AdminIOSAppBuildAndRun POST /api/admin/ios-app/build-and-run — 启动真机构建安装。
func (h *Handler) AdminIOSAppBuildAndRun(c *gin.Context) {
	var body service.IOSAppBuildOptions
	_ = c.ShouldBindJSON(&body)
	id, err := h.svc.StartIOSAppBuildAndRun(body)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "another ios build job is running" {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"job_id": id})
}

// AdminIOSAppBuildJobStream GET /api/admin/ios-app/build-job/:id/stream — SSE 日志。
func (h *Handler) AdminIOSAppBuildJobStream(c *gin.Context) {
	id := c.Param("id")
	lines, ch, done, ok, errMsg, err := h.svc.SubscribeIOSAppBuildJob(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	flusher, okf := c.Writer.(http.Flusher)
	if !okf {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	writeEvent := func(ev string, payload any) {
		b, _ := json.Marshal(payload)
		_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", ev, b)
		flusher.Flush()
	}

	for _, line := range lines {
		writeEvent("log", gin.H{"line": line})
	}
	if done {
		if ok {
			writeEvent("done", gin.H{"ok": true})
		} else {
			writeEvent("error", gin.H{"error": errMsg})
		}
		return
	}
	defer h.svc.UnsubscribeIOSAppBuildJob(id, ch)

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	clientGone := c.Request.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case <-ticker.C:
			writeEvent("ping", gin.H{"ts": time.Now().Unix()})
		case line, open := <-ch:
			if !open {
				_, dok, derr, _ := h.svc.SnapshotIOSAppBuildJob(id)
				if dok {
					writeEvent("done", gin.H{"ok": true})
				} else {
					writeEvent("error", gin.H{"error": derr})
				}
				return
			}
			writeEvent("log", gin.H{"line": line})
		}
	}
}
