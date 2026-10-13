package handler

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// AdminChatImageUpload POST /api/admin/chat-images
func (h *Handler) AdminChatImageUpload(c *gin.Context) {
	h.uploadChatImage(c)
}

// PublicChatImageUpload POST /api/public/chat-images（需访客 cookie）
func (h *Handler) PublicChatImageUpload(c *gin.Context) {
	if _, ok := h.requireVisitor(c); !ok {
		return
	}
	h.uploadChatImage(c)
}

func (h *Handler) uploadChatImage(c *gin.Context) {
	file, hdr, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 8<<20+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "read failed"})
		return
	}
	if len(raw) > 8<<20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图片过大（上限 8MB）"})
		return
	}
	name := ""
	if hdr != nil {
		name = hdr.Filename
	}
	att, err := h.svc.SaveChatImage(c.Request.Context(), raw, name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, att)
}

// ServeChatImage GET /api/chat-images/:name — 本地落盘图（UUID 文件名）
func (h *Handler) ServeChatImage(c *gin.Context) {
	name := filepath.Base(strings.TrimSpace(c.Param("name")))
	if name == "" || strings.Contains(name, "..") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad name"})
		return
	}
	if !strings.HasSuffix(strings.ToLower(name), ".jpg") &&
		!strings.HasSuffix(strings.ToLower(name), ".jpeg") &&
		!strings.HasSuffix(strings.ToLower(name), ".png") &&
		!strings.HasSuffix(strings.ToLower(name), ".webp") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported"})
		return
	}
	path := filepath.Join(h.svc.ChatImageDir(), name)
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.File(path)
}

func parseAskAttachments(raw []struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Mime string `json:"mime"`
	Name string `json:"name"`
}) []service.ChatAttachment {
	var out []service.ChatAttachment
	for _, a := range raw {
		out = append(out, service.ChatAttachment{
			ID: strings.TrimSpace(a.ID), URL: strings.TrimSpace(a.URL),
			Mime: strings.TrimSpace(a.Mime), Name: strings.TrimSpace(a.Name),
		})
	}
	return service.NormalizeChatAttachments(out)
}
