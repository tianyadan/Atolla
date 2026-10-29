package service

import (
	"context"

	"atolla/server/internal/remotebridge"
)

func chatAttsToQueue(atts []remotebridge.ChatAtt) []TaskQueueAttachment {
	out := make([]TaskQueueAttachment, 0, len(atts))
	for _, x := range atts {
		out = append(out, TaskQueueAttachment{ID: x.ID, URL: x.URL, Mime: x.Mime, Name: x.Name})
	}
	return out
}

// ListAgentTaskQueue implements remotebridge.AgentRuntime.
func (s *Service) ListAgentTaskQueue(ctx context.Context, agentID int64) (any, error) {
	return s.ListTaskQueue(ctx, agentID)
}

// EnqueueAgentTaskQueue implements remotebridge.AgentRuntime.
func (s *Service) EnqueueAgentTaskQueue(ctx context.Context, agentID int64, question string, atts []remotebridge.ChatAtt) (any, error) {
	out, err := s.EnqueueAgentTaskEx(ctx, agentID, question, chatAttsToQueue(atts))
	if err != nil {
		return nil, err
	}
	if out.Kickoff != nil {
		go s.autoRunClaimedTaskQueueItem(agentID, out.Kickoff)
	}
	return out.Item, nil
}

// InterruptAgentTaskQueue implements remotebridge.AgentRuntime.
func (s *Service) InterruptAgentTaskQueue(ctx context.Context, agentID int64, question string, atts []remotebridge.ChatAtt) (any, error) {
	return s.InterruptPreferAgentTask(ctx, agentID, question, chatAttsToQueue(atts))
}

// ContinueAndRunAgentTaskQueue implements remotebridge.AgentRuntime：claim 后自动开跑。
func (s *Service) ContinueAndRunAgentTaskQueue(ctx context.Context, agentID int64) (any, error) {
	item, err := s.ContinueAgentTaskQueue(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if item != nil {
		go s.autoRunClaimedTaskQueueItem(agentID, item)
	}
	resume := item != nil && item.ResumeHint
	return map[string]any{"ok": true, "task": item, "resume_prefix": resume}, nil
}

// CancelAgentTaskQueue implements remotebridge.AgentRuntime.
func (s *Service) CancelAgentTaskQueue(ctx context.Context, agentID, taskID int64) error {
	return s.CancelAgentTaskQueueItem(ctx, agentID, taskID)
}

// UpdateAgentTaskQueue implements remotebridge.AgentRuntime：改写未执行文案。
func (s *Service) UpdateAgentTaskQueue(ctx context.Context, agentID, taskID int64, question string) error {
	return s.UpdateAgentTaskQueueQuestion(ctx, agentID, taskID, question)
}
