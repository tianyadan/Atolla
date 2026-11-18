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
	Config  *ConfigStore
}

// RegisteredActions lists actions advertised at register/heartbeat.
func RegisteredActions() []string {
	return []string{
		"ping",
		"sync.agents",
		"sync.tasks",
		"sync.messages",
		"agent.ask",
		"agent.task_queue.list",
		"agent.task_queue.enqueue",
		"agent.task_queue.interrupt",
		"agent.task_queue.continue",
		"agent.task_queue.cancel",
		"agent.task_queue.update",
		"agent.task_queue.clear_done",
		"receptionist.ask",
		"github.idea.event",
		"agent.stop",
		"agent.set_task_plan",
		"agent.task_plan.active",
		"agent.task_plan.confirm",
		"agent.task_plan.reject",
		"agent.task_plan.abort",
		"agent.task_plan.resume",
		"agent.set_auto_review",
		"agent.set_auto_approve_all",
		"permission.decide",
		"viewer.set",
		"viewer.clear",
		"agent.mark_read",
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
		"notify.bark.verify.send",
		"notify.bark.verify.confirm",
		"engines.usage.get",
		"jevos.settings.get",
		"jevos.settings.install",
		"jevos.settings.set",
		"jevos.settings.uninstall",
		"instance.send_unlock_otp",
	}
}

// Handlers maps executable V1 actions.
var Handlers = map[string]Handler{
	"ping":                        handlePing,
	"sync.agents":                 handleSyncAgents,
	"sync.tasks":                  handleSyncTasks,
	"sync.messages":               handleSyncMessages,
	"agent.ask":                   handleAgentAsk,
	"agent.task_queue.list":       handleAgentTaskQueueList,
	"agent.task_queue.enqueue":    handleAgentTaskQueueEnqueue,
	"agent.task_queue.interrupt":  handleAgentTaskQueueInterrupt,
	"agent.task_queue.continue":   handleAgentTaskQueueContinue,
	"agent.task_queue.cancel":     handleAgentTaskQueueCancel,
	"agent.task_queue.update":     handleAgentTaskQueueUpdate,
	"agent.task_queue.clear_done": handleAgentTaskQueueClearDone,
	"receptionist.ask":            handleReceptionistAsk,
	"github.idea.event":           handleGitHubIdeaEvent,
	"agent.stop":                  handleAgentStop,
	"agent.set_task_plan":         handleAgentSetTaskPlan,
	"agent.task_plan.active":      handleAgentTaskPlanActive,
	"agent.task_plan.confirm":     handleAgentTaskPlanConfirm,
	"agent.task_plan.reject":      handleAgentTaskPlanReject,
	"agent.task_plan.abort":       handleAgentTaskPlanAbort,
	"agent.task_plan.resume":      handleAgentTaskPlanResume,
	"agent.set_auto_review":       handleAgentSetAutoReview,
	"agent.set_auto_approve_all":  handleAgentSetAutoApproveAll,
	"permission.decide":           handlePermissionDecide,
	"viewer.set":                  handleViewerSet,
	"viewer.clear":                handleViewerClear,
	"agent.mark_read":             handleAgentMarkRead,
	"agent.create":                handleAgentCreate,
	"agent.settings.get":          handleAgentSettingsGet,
	"agent.settings.update":       handleAgentSettingsUpdate,
	"agent.skills.list":           handleAgentSkillsList,
	"agent.skills.store":          handleAgentSkillsStore,
	"agent.skills.install":        handleAgentSkillsInstall,
	"agent.skills.uninstall":      handleAgentSkillsUninstall,
	"agent.legacy_mounts.list":    handleAgentLegacyMountsList,
	"chat.image.upload":           handleChatImageUpload,
	"notify.prefs.get":            handleNotifyPrefsGet,
	"notify.prefs.update":         handleNotifyPrefsUpdate,
	"notify.bark.verify.send":     handleNotifyBarkVerifySend,
	"notify.bark.verify.confirm":  handleNotifyBarkVerifyConfirm,
	"engines.usage.get":           handleEnginesUsageGet,
	"jevos.settings.get":          handleJevosSettingsGet,
	"jevos.settings.install":      handleJevosSettingsInstall,
	"jevos.settings.set":          handleJevosSettingsSet,
	"jevos.settings.uninstall":    handleJevosSettingsUninstall,
	"instance.send_unlock_otp":    handleInstanceSendUnlockOtp,
}
