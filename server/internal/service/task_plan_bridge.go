package service

import "context"

// GetActiveTaskPlan implements remotebridge.AgentRuntime。
func (s *Service) GetActiveTaskPlan(ctx context.Context, agentID int64) (any, error) {
	view, err := s.LookupActiveTaskPlan(ctx, agentID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"plan": view}, nil
}

// ConfirmTaskPlan implements remotebridge.AgentRuntime（steps 为 JSON 任意结构）。
func (s *Service) ConfirmTaskPlan(ctx context.Context, agentID int64, planID string, steps any) (any, error) {
	view, err := s.ConfirmTaskPlanSteps(ctx, agentID, planID, parseStepsFromConfirmPayload(steps))
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "plan": view}, nil
}

// RejectTaskPlan implements remotebridge.AgentRuntime。
func (s *Service) RejectTaskPlan(ctx context.Context, agentID int64, planID string) error {
	return s.RejectTaskPlanDraft(ctx, agentID, planID)
}

// AbortTaskPlan implements remotebridge.AgentRuntime。
func (s *Service) AbortTaskPlan(ctx context.Context, agentID int64, planID string) error {
	return s.AbortTaskPlanRun(ctx, agentID, planID)
}

// ResumeTaskPlan implements remotebridge.AgentRuntime。
func (s *Service) ResumeTaskPlan(ctx context.Context, agentID int64, planID string) error {
	return s.ResumeTaskPlanRun(ctx, agentID, planID)
}
