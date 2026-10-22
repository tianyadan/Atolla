package remotebridge

import (
	"context"

	"atolla/server/internal/store"
)

// Handler executes one relay command action locally.
type Handler func(ctx *ExecContext) (resultBody any, err error)

// MobileViewer tracks which agent the phone UI is currently viewing.
type MobileViewer interface {
	SetMobileViewer(agentID int64)
	ClearMobileViewer()
	MobileViewingAgentID() (agentID int64, ok bool)
}

// ExecContext carries dependencies for action handlers.
type ExecContext struct {
	Context context.Context
	Store   *store.Store
	Client  *RelayClient
	Payload map[string]interface{}
	Runtime AgentRuntime
	Viewer  MobileViewer
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
		"viewer.set",
		"viewer.clear",
		"agent.create",
		"agent.settings.get",
		"agent.settings.update",
		"agent.skills.list",
		"agent.skills.store",
		"agent.skills.install",
		"agent.skills.uninstall",
		"agent.legacy_mounts.list",
		"chat.image.upload",
		"notify.prefs.get",
		"notify.prefs.update",
		"engines.usage.get",
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
	"viewer.set":                 handleViewerSet,
	"viewer.clear":               handleViewerClear,
	"agent.create":               handleAgentCreate,
	"agent.settings.get":         handleAgentSettingsGet,
	"agent.settings.update":      handleAgentSettingsUpdate,
	"agent.skills.list":          handleAgentSkillsList,
	"agent.skills.store":         handleAgentSkillsStore,
	"agent.skills.install":       handleAgentSkillsInstall,
	"agent.skills.uninstall":     handleAgentSkillsUninstall,
	"agent.legacy_mounts.list":   handleAgentLegacyMountsList,
	"chat.image.upload":          handleChatImageUpload,
	"notify.prefs.get":           handleNotifyPrefsGet,
	"notify.prefs.update":        handleNotifyPrefsUpdate,
	"engines.usage.get":          handleEnginesUsageGet,
}
