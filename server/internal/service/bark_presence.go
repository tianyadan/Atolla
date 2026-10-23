package service

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/notify"
	"atolla/server/internal/store"
)

var errNotifyStore = errors.New("通知设置暂不可用")

// pcViewerTTL 电脑对话页心跳超过此时长视为已离开（后台标签节流仍能续上）。
const pcViewerTTL = 90 * time.Second

// SetPCViewer 记录电脑端正在查看的数字人。
func (s *Service) SetPCViewer(agentID int64) {
	if s == nil || agentID <= 0 {
		return
	}
	s.pcViewMu.Lock()
	s.pcViewAgent = agentID
	s.pcViewAt = time.Now()
	s.pcViewMu.Unlock()
}

// ClearPCViewer 电脑端离开数字人对话。
func (s *Service) ClearPCViewer() {
	if s == nil {
		return
	}
	s.pcViewMu.Lock()
	s.pcViewAgent = 0
	s.pcViewAt = time.Time{}
	s.pcViewMu.Unlock()
}

// agentChatOpen 电脑或手机正打开该数字人对话时为 true。手机锁屏应先清掉查看态。
func (s *Service) agentChatOpen(agentID int64) bool {
	if s == nil || agentID <= 0 {
		return false
	}
	s.pcViewMu.Lock()
	pcID, pcAt := s.pcViewAgent, s.pcViewAt
	s.pcViewMu.Unlock()
	if pcID == agentID && !pcAt.IsZero() && time.Since(pcAt) <= pcViewerTTL {
		return true
	}
	if s.RemoteBridge != nil {
		if id, ok := s.RemoteBridge.MobileViewingAgentID(); ok && id == agentID {
			return true
		}
	}
	return false
}

// GetNotifyPrefs 读取通知开关。没有库时按默认开启返回。
func (s *Service) GetNotifyPrefs(ctx context.Context) (store.NotifyPrefs, error) {
	if s == nil || s.Store == nil {
		return defaultNotifyPrefs(), nil
	}
	return s.Store.GetNotifyPrefs(ctx)
}

// SaveNotifyPrefs 保存通知开关。
func (s *Service) SaveNotifyPrefs(ctx context.Context, p store.NotifyPrefs) error {
	if s == nil || s.Store == nil {
		return errNotifyStore
	}
	return s.Store.SaveNotifyPrefs(ctx, p)
}

func defaultNotifyPrefs() store.NotifyPrefs {
	return store.NotifyPrefs{TaskDone: true, Permission: true}
}

// barkKindAllowed 按去重键前缀判断该类通知是否打开。
func barkKindAllowed(prefs store.NotifyPrefs, dedupe string) bool {
	switch {
	case strings.HasPrefix(dedupe, "perm:"):
		return prefs.Permission
	case strings.HasPrefix(dedupe, "done:"):
		return prefs.TaskDone
	default:
		return true
	}
}

// notifyPermissionPending 两端都不在该对话、且开关打开时推送待审批。
func (s *Service) notifyPermissionPending(agentID int64, requestID, summary, risk string) {
	if strings.TrimSpace(requestID) == "" {
		return
	}
	s.PushPermissionBarkIfAllowed(agentID, requestID, summary, risk)
}

// notifyTaskDone 两端都不在该对话、且开关打开时推送完成，标题不超过 10 个字。
func (s *Service) notifyTaskDone(agentID int64, question, dedupe string) {
	if strings.TrimSpace(dedupe) == "" {
		return
	}
	s.PushTaskDoneBarkIfAllowed(agentID, dedupe, question)
}

// PushBarkIfAllowed 供管理接口复用：对话未打开且对应开关开启才推送。
func (s *Service) PushBarkIfAllowed(agentID int64, dedupe, body string) bool {
	name, department, _ := s.barkAgentIdentity(context.Background(), agentID)
	return s.pushBarkCard(agentID, notify.Card{
		DedupeKey: dedupe,
		Title:     "Atolla",
		Body:      name + "｜" + department + "\n" + strings.TrimSpace(body),
		Icon:      s.barkAppIconURL(),
		Group:     notify.AtollaGroup,
	})
}

// PushPermissionBarkIfAllowed 推送包含员工、部门、命令摘要和风险的审批卡片。
func (s *Service) PushPermissionBarkIfAllowed(agentID int64, requestID, summary, risk string) bool {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return false
	}
	name, department, _ := s.barkAgentIdentity(context.Background(), agentID)
	card := notify.PermissionCard(name, department, summary, risk)
	card.DedupeKey = "perm:" + requestID
	card.Icon = s.barkAppIconURL()
	card.URL = s.barkDeepLink("approval", agentID, requestID)
	return s.pushBarkCard(agentID, card)
}

// PushTaskDoneBarkIfAllowed 推送包含员工、部门、任务摘要和运行耗时的完成卡片。
func (s *Service) PushTaskDoneBarkIfAllowed(agentID int64, dedupe, question string) bool {
	dedupe = strings.TrimSpace(dedupe)
	if dedupe == "" {
		return false
	}
	name, department, durationMS := s.barkAgentIdentity(context.Background(), agentID)
	card := notify.TaskDoneCard(name, department, question, durationMS)
	card.DedupeKey = "done:" + dedupe
	card.Icon = s.barkAppIconURL()
	card.URL = s.barkDeepLink("agent", agentID, "")
	return s.pushBarkCard(agentID, card)
}

func (s *Service) pushBarkCard(agentID int64, card notify.Card) bool {
	if s == nil || s.Notify == nil || agentID <= 0 || s.agentChatOpen(agentID) {
		return false
	}
	prefs := defaultNotifyPrefs()
	if s.Store != nil {
		if loaded, err := s.Store.GetNotifyPrefs(context.Background()); err == nil {
			prefs = loaded
		}
	}
	if !barkKindAllowed(prefs, card.DedupeKey) {
		return false
	}
	return s.Notify.Push(card)
}

func (s *Service) barkAgentIdentity(ctx context.Context, agentID int64) (name, department string, durationMS int) {
	name, department = "数字员工", "未分组"
	if s == nil || s.Store == nil || agentID <= 0 {
		return name, department, 0
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return name, department, 0
	}
	enriched := s.EnrichAgentsFolderNames(ctx, []store.ManagedAgent{*a})
	if len(enriched) > 0 {
		a = &enriched[0]
	}
	if strings.TrimSpace(a.Name) != "" {
		name = strings.TrimSpace(a.Name)
	}
	if strings.TrimSpace(a.FolderName) != "" {
		department = strings.TrimSpace(a.FolderName)
	}
	return name, department, a.LastRunMs
}

// barkAppIconURL 始终返回 Atolla App 图标，不再把员工头像当作通知来源图标。
func (s *Service) barkAppIconURL() string {
	if s == nil {
		return ""
	}
	if icon := strings.TrimSpace(s.Cfg.BarkIconURL); icon != "" {
		return icon
	}
	if s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return ""
	}
	base := strings.TrimRight(strings.TrimSpace(s.RemoteBridge.Config.Public().BaseURL), "/")
	if base == "" {
		return ""
	}
	return base + "/app-icon-1024.png"
}

func (s *Service) barkDeepLink(kind string, agentID int64, requestID string) string {
	if s == nil || agentID <= 0 || s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return ""
	}
	instanceID := strings.TrimSpace(s.RemoteBridge.Config.Public().InstanceID)
	if instanceID == "" {
		return ""
	}
	base := "atolla://agent/" + url.PathEscape(instanceID) + "/" + strconv.FormatInt(agentID, 10)
	if kind == "approval" {
		requestID = strings.TrimSpace(requestID)
		if requestID == "" {
			return ""
		}
		return "atolla://approval/" + url.PathEscape(instanceID) + "/" + strconv.FormatInt(agentID, 10) + "/" + url.PathEscape(requestID)
	}
	return base + "/chat"
}
