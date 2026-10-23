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
	AskManagedBackground(ctx context.Context, agentID int64, question string, atts []ChatAtt) error
	// SaveChatImageFromBytes compresses and stores an uploaded image (local + optional OSS).
	SaveChatImageFromBytes(ctx context.Context, raw []byte, filename string) (*ChatAtt, error)
	StopManaged(agentID int64) bool
	// SetAutoReview persists AI auto-review and updates the live Hub for the agent conversation.
	SetAutoReview(ctx context.Context, agentID int64, enabled bool) error
	// SetAutoApproveAll persists「命令全部审批通过」.
	SetAutoApproveAll(ctx context.Context, agentID int64, enabled bool) error
	// DecidePermission resolves a pending Hub request (allow|deny|allow_session).
	DecidePermission(requestID, behavior string) error

	// Mobile settings: skills + legacy mounts (service-layer for browser-use / flag sync).
	ListAgentSkills(ctx context.Context, agentID int64) ([]store.AgentSkillView, error)
	ListSkillStore(ctx context.Context, q, category, risk string) ([]store.SkillCatalogItem, error)
	InstallAgentSkill(ctx context.Context, agentID int64, skillID, installedBy string, caps []string) ([]store.AgentSkillView, error)
	UninstallAgentSkill(ctx context.Context, agentID int64, skillID string) ([]store.AgentSkillView, error)
	ListAgentLegacyMounts(ctx context.Context, agentID int64) ([]store.AgentLegacyMemoryMount, error)

	// JEV（本机 jevos）：状态 / 安装 / 启停，供手机设置页与自动审核前置。
	JevosSettingsGet(force bool) (any, error)
	JevosSettingsInstall(packageID string) (any, error)
	JevosSettingsSet(enabled bool) (any, error)
}
