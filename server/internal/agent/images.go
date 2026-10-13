package agent

import (
	"encoding/base64"
	"os"
	"strings"
)

// ImagePart is one multimodal image for Claude stream-json user content.
type ImagePart struct {
	Mime string // image/jpeg | image/png | image/webp | image/gif
	Data []byte
	Path string // optional; loaded if Data empty
}

// LoadImagePart reads Path into Data when needed.
func LoadImagePart(p ImagePart) (ImagePart, error) {
	if len(p.Data) > 0 {
		return p, nil
	}
	path := strings.TrimSpace(p.Path)
	if path == "" {
		return p, os.ErrNotExist
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return p, err
	}
	p.Data = b
	if p.Mime == "" {
		p.Mime = mimeFromPath(path)
	}
	return p, nil
}

func mimeFromPath(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".webp"):
		return "image/webp"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	default:
		return "image/jpeg"
	}
}

// BuildUserContent builds Claude content blocks: images then text.
func BuildUserContent(text string, images []ImagePart) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(images)+1)
	for _, raw := range images {
		img, err := LoadImagePart(raw)
		if err != nil || len(img.Data) == 0 {
			continue
		}
		mime := strings.TrimSpace(img.Mime)
		if mime == "" {
			mime = "image/jpeg"
		}
		out = append(out, map[string]interface{}{
			"type": "image",
			"source": map[string]interface{}{
				"type":       "base64",
				"media_type": mime,
				"data":       base64.StdEncoding.EncodeToString(img.Data),
			},
		})
	}
	out = append(out, map[string]interface{}{"type": "text", "text": text})
	return out
}
