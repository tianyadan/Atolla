package remotebridge

import (
	"context"

	"atolla/server/internal/store"
)

// Handler executes one relay command action locally.
type Handler func(ctx *ExecContext) (resultBody any, err error)

// ExecContext carries dependencies for action handlers.
type ExecContext struct {
	Context context.Context
	Store   *store.Store
	Client  *RelayClient
	Payload map[string]interface{}
	Runtime AgentRuntime
}

// RegisteredActions lists actions advertised at register/heartbeat.
func RegisteredActions() []string {
	return []string{
		"ping",
		"sync.agents",
		"sync.tasks",
		"sync.messages",
		"agent.ask",
		"agent.stop",
		"agent.set_task_plan",
		"agent.set_auto_review",
		"agent.set_auto_approve_all",
		"permission.decide",
	}
}

// Handlers maps executable V1 actions.
var Handlers = map[string]Handler{
	"ping":                       handlePing,
	"sync.agents":                handleSyncAgents,
	"sync.tasks":                 handleSyncTasks,
	"sync.messages":              handleSyncMessages,
	"agent.ask":                  handleAgentAsk,
	"agent.stop":                 handleAgentStop,
	"agent.set_task_plan":        handleAgentSetTaskPlan,
	"agent.set_auto_review":      handleAgentSetAutoReview,
	"agent.set_auto_approve_all": handleAgentSetAutoApproveAll,
	"permission.decide":          handlePermissionDecide,
}
