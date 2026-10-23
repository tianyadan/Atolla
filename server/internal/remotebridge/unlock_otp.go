package remotebridge

import (
	"fmt"
	"strings"
)

/** handleInstanceSendUnlockOtp 中继下发：用本机 SMTP 把一次性验证码发到收件邮箱 */
func handleInstanceSendUnlockOtp(ec *ExecContext) (any, error) {
	if ec == nil || ec.Config == nil {
		return nil, fmt.Errorf("smtp config missing")
	}
	cfg := ec.Config.Get()
	to, _ := ec.Payload["to_email"].(string)
	code, _ := ec.Payload["code"].(string)
	var expiresAt int64
	switch v := ec.Payload["expires_at"].(type) {
	case float64:
		expiresAt = int64(v)
	case int64:
		expiresAt = v
	case int:
		expiresAt = int64(v)
	}
	to = strings.TrimSpace(to)
	code = strings.TrimSpace(code)
	if to == "" || code == "" {
		return nil, fmt.Errorf("to_email and code required")
	}
	if err := SendUnlockOTPMail(cfg, to, code, expiresAt); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sent_to": to}, nil
}
