package service

import (
	"context"
	"errors"
	"strings"

	"atolla/server/internal/store"
)

var ErrAgentConversationBusy = errors.New("数字人正在工作，暂时不能切换会话")

// AgentConversationStatusBusy 集中维护会话切换的忙碌状态，避免切换后输出落入错误线程。
func AgentConversationStatusBusy(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "running", "busy", "waiting", "插话中", "initializing", "compressing":
		return true
	default:
		return false
	}
}

func (s *Service) ListAgentConversations(ctx context.Context, limit int, includeArchived bool) ([]store.AgentConversationSummary, error) {
	return s.Store.ListAgentConversations(ctx, limit, includeArchived)
}

func (s *Service) CreateAgentConversationThread(ctx context.Context, agentID int64, title string) (*store.AgentConversationSummary, error) {
	if err := s.guardAgentConversationSwitch(ctx, agentID); err != nil {
		return nil, err
	}
	return s.Store.CreateAndActivateAgentConversation(ctx, agentID, title)
}

func (s *Service) ActivateAgentConversationThread(ctx context.Context, agentID, conversationID int64) error {
	if err := s.guardAgentConversationSwitch(ctx, agentID); err != nil {
		return err
	}
	return s.Store.ActivateAgentConversation(ctx, agentID, conversationID)
}

func (s *Service) UpdateAgentConversationThread(ctx context.Context, conversationID int64, patch store.AgentConversationPatch) error {
	return s.Store.UpdateAgentConversation(ctx, conversationID, patch)
}

func (s *Service) guardAgentConversationSwitch(ctx context.Context, agentID int64) error {
	s.runMu.Lock()
	_, running := s.runs[agentID]
	s.runMu.Unlock()
	if running {
		return ErrAgentConversationBusy
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil {
		return err
	}
	if a == nil {
		return errors.New("agent not found")
	}
	if AgentConversationStatusBusy(a.Status) {
		return ErrAgentConversationBusy
	}
	if occ, err := s.Store.GetOccupancy(ctx, agentID); err != nil {
		return err
	} else if occ != nil {
		return ErrAgentConversationBusy
	}
	return nil
}
