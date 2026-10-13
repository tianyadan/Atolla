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
}

// RegisteredActions lists actions advertised at register/heartbeat.
func RegisteredActions() []string {
	return []string{"ping", "sync.agents", "sync.tasks", "sync.messages"}
}

// Handlers maps executable V1 actions. agent.ask / agent.stop are intentionally absent.
var Handlers = map[string]Handler{
	"ping":          handlePing,
	"sync.agents":   handleSyncAgents,
	"sync.tasks":    handleSyncTasks,
	"sync.messages": handleSyncMessages,
}
