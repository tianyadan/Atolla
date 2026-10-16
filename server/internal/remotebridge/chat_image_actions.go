package remotebridge

import (
	"encoding/base64"
	"fmt"
	"strings"
)

// handleChatImageUpload accepts base64 JPEG/PNG bytes and stores via SaveChatImage.
func handleChatImageUpload(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	b64, _ := ec.Payload["data_base64"].(string)
	b64 = strings.TrimSpace(b64)
	if b64 == "" {
		return nil, fmt.Errorf("data_base64 required")
	}
	// Allow data URL prefix
	if i := strings.Index(b64, ","); i >= 0 && strings.Contains(strings.ToLower(b64[:i]), "base64") {
		b64 = b64[i+1:]
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		// try raw std without padding issues
		raw, err = base64.RawStdEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("invalid base64: %w", err)
		}
	}
	name, _ := ec.Payload["filename"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "mobile.jpg"
	}
	att, err := ec.Runtime.SaveChatImageFromBytes(ec.Context, raw, name)
	if err != nil {
		return nil, err
	}
	if att == nil {
		return nil, fmt.Errorf("empty attachment")
	}
	return map[string]any{
		"id":   att.ID,
		"url":  att.URL,
		"mime": att.Mime,
		"name": att.Name,
	}, nil
}
