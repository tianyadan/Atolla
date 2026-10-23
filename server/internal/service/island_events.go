package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"atolla/server/internal/store"
)

const (
	IslandEventError     = "error"
	IslandEventApproval  = "approval"
	IslandEventRunning   = "running"
	IslandEventCompleted = "completed"
)

// IslandEvent 是 macOS 灵动岛消费的统一事件，终态仅包含每位数字人的最新未读快照。
type IslandEvent struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	AgentID    int64  `json:"agent_id"`
	AgentName  string `json:"agent_name"`
	JellyColor string `json:"jelly_color,omitempty"`
	GroupName  string `json:"group_name"`
	Status     string `json:"status"`
	OccurredAt string `json:"occurred_at"`
	DurationMs int    `json:"duration_ms,omitempty"`
	Summary    string `json:"summary,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
}

// IslandPresentation 只返回当前最高优先级类别，避免不同状态在小岛里互相争抢。
type IslandPresentation struct {
	ActiveKind string        `json:"active_kind,omitempty"`
	Count      int           `json:"count"`
	Items      []IslandEvent `json:"items"`
}

type islandApproval struct {
	RequestID string
	AgentID   int64
	Summary   string
	CreatedAt time.Time
}

// ListIslandEvents 聚合报错、审批、运行中、已完成，并按固定优先级选择当前展示类别。
func (s *Service) ListIslandEvents(ctx context.Context) (IslandPresentation, error) {
	agents, err := s.Store.ListManagedAgents(ctx)
	if err != nil {
		return IslandPresentation{}, err
	}
	agents = s.EnrichAgentsFolderNames(ctx, agents)
	occupancy, _ := s.Store.ListOccupancyMap(ctx)

	approvals := make([]islandApproval, 0)
	if s.Perms != nil {
		for _, p := range s.Perms.Pending(0) {
			agentID, lookupErr := s.Store.ConversationAgentID(ctx, p.ConvID)
			if lookupErr != nil || agentID <= 0 {
				continue
			}
			createdAt, _ := time.Parse(time.RFC3339, p.CreatedAt)
			summary := strings.TrimSpace(p.Summary)
			if summary == "" {
				summary = strings.TrimSpace(p.Meaning)
			}
			if summary == "" {
				summary = strings.TrimSpace(p.ToolName)
			}
			approvals = append(approvals, islandApproval{
				RequestID: p.ID, AgentID: agentID, Summary: summary, CreatedAt: createdAt,
			})
		}
	}
	events := buildIslandEvents(agents, occupancy, approvals, time.Now())
	// 正在查看的对话不展示 completed/error 未读终态（用户已在看）
	filtered := make([]IslandEvent, 0, len(events))
	for _, ev := range events {
		if (ev.Kind == IslandEventCompleted || ev.Kind == IslandEventError) && s.agentChatOpen(ev.AgentID) {
			continue
		}
		filtered = append(filtered, ev)
	}
	return selectIslandPresentation(filtered, 5), nil
}

func buildIslandEvents(agents []store.ManagedAgent, occupancy map[int64]store.Occupancy, approvals []islandApproval, now time.Time) []IslandEvent {
	byID := make(map[int64]store.ManagedAgent, len(agents))
	events := make([]IslandEvent, 0, len(agents)+len(approvals))
	for _, agent := range agents {
		byID[agent.ID] = agent
		group := islandGroupName(agent.FolderName)
		kind := strings.ToLower(strings.TrimSpace(agent.TaskUnreadKind))
		if agent.TaskUnread && agent.TaskUnreadAt != nil && !agent.TaskUnreadAt.IsZero() && (kind == IslandEventError || kind == IslandEventCompleted) {
			events = append(events, IslandEvent{
				ID: fmt.Sprintf("%s:%d", kind, agent.ID), Kind: kind,
				AgentID: agent.ID, AgentName: agent.Name, JellyColor: agent.JellyColor,
				GroupName: group, Status: agent.Status, OccurredAt: agent.TaskUnreadAt.UTC().Format(time.RFC3339),
				DurationMs: agent.TaskUnreadDurationMs, Summary: strings.TrimSpace(agent.TaskUnreadSummary),
			})
		}

		occ, occupied := occupancy[agent.ID]
		status := strings.ToLower(strings.TrimSpace(agent.Status))
		running := occupied && (strings.EqualFold(occ.SourceType, "WORKFLOW") || occ.WorkflowRunID > 0)
		running = running || status == "running" || status == "busy" || status == "插话中" || status == "initializing" || status == "compressing" || status == "waiting"
		if running {
			started := now
			if agent.RunStartedAt != nil && !agent.RunStartedAt.IsZero() {
				started = *agent.RunStartedAt
			} else if occupied && !occ.StartedAt.IsZero() {
				started = occ.StartedAt
			}
			events = append(events, IslandEvent{
				ID: fmt.Sprintf("running:%d", agent.ID), Kind: IslandEventRunning,
				AgentID: agent.ID, AgentName: agent.Name, JellyColor: agent.JellyColor,
				GroupName: group, Status: agent.Status, OccurredAt: started.UTC().Format(time.RFC3339),
			})
		}
	}

	for _, approval := range approvals {
		agent, ok := byID[approval.AgentID]
		if !ok || strings.TrimSpace(approval.RequestID) == "" {
			continue
		}
		createdAt := approval.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		events = append(events, IslandEvent{
			ID: "approval:" + approval.RequestID, Kind: IslandEventApproval,
			AgentID: agent.ID, AgentName: agent.Name, JellyColor: agent.JellyColor,
			GroupName: islandGroupName(agent.FolderName), Status: agent.Status,
			OccurredAt: createdAt.UTC().Format(time.RFC3339), Summary: strings.TrimSpace(approval.Summary),
			RequestID: approval.RequestID,
		})
	}
	return events
}

func selectIslandPresentation(events []IslandEvent, limit int) IslandPresentation {
	result := IslandPresentation{Items: []IslandEvent{}}
	for _, kind := range []string{IslandEventError, IslandEventApproval, IslandEventRunning, IslandEventCompleted} {
		items := make([]IslandEvent, 0)
		for _, event := range events {
			if event.Kind == kind {
				items = append(items, event)
			}
		}
		if len(items) == 0 {
			continue
		}
		sort.SliceStable(items, func(i, j int) bool { return items[i].OccurredAt > items[j].OccurredAt })
		result.ActiveKind = kind
		result.Count = len(items)
		if limit > 0 && len(items) > limit {
			items = items[:limit]
		}
		result.Items = items
		break
	}
	return result
}

func islandGroupName(raw string) string {
	if group := strings.TrimSpace(raw); group != "" {
		return group
	}
	return "未分组"
}
