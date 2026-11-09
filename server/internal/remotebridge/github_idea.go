package remotebridge

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
)

type githubIdeaRuntime interface {
	HandleGitHubIdeaEvent(ctx context.Context, deliveryID, event, signature string, body []byte) (any, error)
}

// handleGitHubIdeaEvent 保留中继透传的原始 JSON，最终签名校验只在持有 Secret 的本机执行。
func handleGitHubIdeaEvent(ec *ExecContext) (any, error) {
	runtime, ok := ec.Runtime.(githubIdeaRuntime)
	if !ok {
		return nil, fmt.Errorf("GitHub Idea runtime not configured")
	}
	deliveryID, _ := ec.Payload["delivery_id"].(string)
	event, _ := ec.Payload["event"].(string)
	signature, _ := ec.Payload["signature"].(string)
	bodyBase64, _ := ec.Payload["body_base64"].(string)
	if strings.TrimSpace(deliveryID) == "" || strings.TrimSpace(event) == "" || strings.TrimSpace(signature) == "" || strings.TrimSpace(bodyBase64) == "" {
		return nil, fmt.Errorf("invalid GitHub webhook payload")
	}
	body, err := base64.StdEncoding.DecodeString(bodyBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid GitHub webhook body: %w", err)
	}
	return runtime.HandleGitHubIdeaEvent(ec.Context, deliveryID, event, signature, body)
}
