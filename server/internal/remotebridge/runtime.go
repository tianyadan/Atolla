package remotebridge

import "context"

// AgentRuntime lets the bridge invoke managed-agent Ask/Stop without importing service (avoids cycles).
type AgentRuntime interface {
	AskManagedBackground(ctx context.Context, agentID int64, question string) error
	StopManaged(agentID int64) bool
	// SetAutoReview persists AI auto-review and updates the live Hub for the agent conversation.
	SetAutoReview(ctx context.Context, agentID int64, enabled bool) error
	// SetAutoApproveAll persists「命令全部审批通过」.
	SetAutoApproveAll(ctx context.Context, agentID int64, enabled bool) error
	// DecidePermission resolves a pending Hub request (allow|deny|allow_session).
	DecidePermission(requestID, behavior string) error
}
