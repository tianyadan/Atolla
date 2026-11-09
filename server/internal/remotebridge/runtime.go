package remotebridge

import (
	"context"

	"atolla/server/internal/store"
)

// ChatAtt is a chat image attachment passed through relay ask/upload.
type ChatAtt struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Mime string `json:"mime"`
	Name string `json:"name"`
}

// AgentRuntime lets the bridge invoke managed-agent Ask/Stop without importing service (avoids cycles).
type AgentRuntime interface {
	// AskManagedBackground 手机 Ask；mode: ""|enqueue|interrupt|direct（忙碌时 "" 默认入队）。
	AskManagedBackground(ctx context.Context, agentID int64, question string, atts []ChatAtt, mode string) error
	// SaveChatImageFromBytes compresses and stores an uploaded image (local + optional OSS).
	SaveChatImageFromBytes(ctx context.Context, raw []byte, filename string) (*ChatAtt, error)
	StopManaged(agentID int64) bool

	// 任务队列（手机轨 / 弹层）
	ListAgentTaskQueue(ctx context.Context, agentID int64) (any, error)
	EnqueueAgentTaskQueue(ctx context.Context, agentID int64, question string, atts []ChatAtt) (any, error)
	InterruptAgentTaskQueue(ctx context.Context, agentID int64, question string, atts []ChatAtt) (any, error)
	ContinueAndRunAgentTaskQueue(ctx context.Context, agentID int64) (any, error)
	CancelAgentTaskQueue(ctx context.Context, agentID int64, taskID int64) error
	UpdateAgentTaskQueue(ctx context.Context, agentID int64, taskID int64, question string) error
	ClearAgentTaskQueueDone(ctx context.Context, agentID int64) error
	// AskSiriReceptionist synchronously asks the configured Receptionist for App Intents.
	AskSiriReceptionist(ctx context.Context, question string) (any, error)
	// SetAutoReview persists AI auto-review and updates the live Hub for the agent conversation.
	SetAutoReview(ctx context.Context, agentID int64, enabled bool) error
	// SetAutoApproveAll persists「命令全部审批通过」.
	SetAutoApproveAll(ctx context.Context, agentID int64, enabled bool) error
	// DecidePermission resolves a pending Hub request (allow|deny|allow_session).
	DecidePermission(requestID, behavior string) error

	// Task Plan v2：查询 / 确认 / 拒绝 / 终止 / 继续。
	GetActiveTaskPlan(ctx context.Context, agentID int64) (any, error)
	ConfirmTaskPlan(ctx context.Context, agentID int64, planID string, steps any) (any, error)
	RejectTaskPlan(ctx context.Context, agentID int64, planID string) error
	AbortTaskPlan(ctx context.Context, agentID int64, planID string) error
	ResumeTaskPlan(ctx context.Context, agentID int64, planID string) error

	// Mobile settings: skills + legacy mounts (service-layer for browser-use / flag sync).
	ListAgentSkills(ctx context.Context, agentID int64) ([]store.AgentSkillView, error)
	ListSkillStore(ctx context.Context, q, category, risk string) ([]store.SkillCatalogItem, error)
	InstallAgentSkill(ctx context.Context, agentID int64, skillID, installedBy string, caps []string) ([]store.AgentSkillView, error)
	UninstallAgentSkill(ctx context.Context, agentID int64, skillID string) ([]store.AgentSkillView, error)
	ListAgentLegacyMounts(ctx context.Context, agentID int64) ([]store.AgentLegacyMemoryMount, error)

	// JEV（本机 jevos）：状态 / 安装 / 启停 / 卸载，供手机设置页与自动审核前置。
	JevosSettingsGet(force bool) (any, error)
	JevosSettingsInstall(packageID string, chinaMirror bool) (any, error)
	JevosSettingsSet(enabled bool) (any, error)
	JevosSettingsUninstall() (any, error)

	// 通知偏好：保存前校验 Bark；发码 / 验码供手机设置页。
	SaveNotifyPrefs(ctx context.Context, prefs store.NotifyPrefs) error
	GetNotifyPrefs(ctx context.Context) (store.NotifyPrefs, error)
	SendNotifyBarkOTP(ctx context.Context) (expiresInSec int, err error)
	ConfirmNotifyBarkOTP(ctx context.Context, code string) error
}
