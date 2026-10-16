package service

import (
	"context"
	"errors"
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
func (s *Service) notifyPermissionPending(agentID int64, requestID string) {
	if strings.TrimSpace(requestID) == "" {
		return
	}
	s.pushBark(agentID, "perm:"+requestID, notify.PermissionPendingText)
}

// notifyTaskDone 两端都不在该对话、且开关打开时推送完成，标题不超过 10 个字。
func (s *Service) notifyTaskDone(agentID int64, question, dedupe string) {
	if strings.TrimSpace(dedupe) == "" {
		return
	}
	s.pushBark(agentID, "done:"+dedupe, notify.TaskDoneText(question))
}

// PushBarkIfAllowed 供管理接口复用：对话未打开且对应开关开启才推送。
func (s *Service) PushBarkIfAllowed(agentID int64, dedupe, body string) bool {
	return s.pushBark(agentID, dedupe, body)
}

func (s *Service) pushBark(agentID int64, dedupe, body string) bool {
	if s == nil || s.Notify == nil || agentID <= 0 || s.agentChatOpen(agentID) {
		return false
	}
	prefs := defaultNotifyPrefs()
	if s.Store != nil {
		if loaded, err := s.Store.GetNotifyPrefs(context.Background()); err == nil {
			prefs = loaded
		}
	}
	if !barkKindAllowed(prefs, dedupe) {
		return false
	}
	name := "数字员工"
	icon := ""
	if s.Store != nil {
		if a, _ := s.Store.GetManagedAgent(context.Background(), agentID); a != nil && strings.TrimSpace(a.Name) != "" {
			name = strings.TrimSpace(a.Name)
		}
		icon = s.EnsureBarkAvatarURL(context.Background(), agentID)
	}
	return s.Notify.PushCard(dedupe, name, body, icon)
}
