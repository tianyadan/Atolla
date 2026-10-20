package service

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/permission"
	"atolla/server/internal/store"
)

// 水母 UI 状态字（与 web/src/jelly/mapAgents.js 对齐）。
const (
	jellyIdle    = "idle"
	jellyWorking = "working"
	jellyWaiting = "waiting"
	jellyError   = "error"
)

// MapJellyState 将 managed_agents.status / 占用 映射为水母 state。
func MapJellyState(status string, hasPendingApproval bool, occ *store.Occupancy) string {
	if hasPendingApproval {
		return jellyWaiting
	}
	s := strings.ToLower(strings.TrimSpace(status))
	switch s {
	case "error":
		return jellyError
	case "waiting":
		return jellyWaiting
	case "running", "busy", "compressing", "initializing", "插话中":
		return jellyWorking
	}
	if occ != nil {
		st := strings.ToUpper(occ.SourceType)
		if st == SourceWorkflow || st == SourceCloneInit || occ.WorkflowRunID > 0 {
			return jellyWorking
		}
	}
	return jellyIdle
}

// JellyCurrentTask 一行当前任务文案（对齐 mapCurrentTask）。
func JellyCurrentTask(a store.ManagedAgent, occ *store.Occupancy, tasks []store.AgentTask) string {
	if occ != nil {
		team := occ.SourceName
		if team == "" {
			team = occ.SourceType
		}
		task := strings.TrimSpace(occ.TaskName)
		line := strings.TrimSpace(team)
		if task != "" {
			if line != "" {
				line += " · " + task
			} else {
				line = task
			}
		}
		if line != "" {
			return truncateRunes(line, 80)
		}
	}
	var active *store.AgentTask
	for i := range tasks {
		st := strings.ToLower(tasks[i].Status)
		if st == "running" || st == "active" || st == "in_progress" || st == "working" {
			active = &tasks[i]
			break
		}
	}
	if active == nil && len(tasks) > 0 {
		active = &tasks[0]
	}
	if active != nil {
		name := strings.TrimSpace(active.TaskName)
		if name == "" {
			name = strings.TrimSpace(active.Message)
		}
		if name != "" && active.Progress > 0 && active.Progress < 100 {
			return fmt.Sprintf("%s · %d%%", truncateRunes(name, 60), active.Progress)
		}
		if name != "" {
			return truncateRunes(name, 80)
		}
		if active.Message != "" {
			return truncateRunes(active.Message, 80)
		}
	}
	switch strings.ToLower(a.Status) {
	case "compressing":
		return "压缩记忆中"
	case "initializing":
		return "初始化中"
	case "running", "busy":
		return "忙碌中"
	case "error":
		if a.LastError != "" {
			return truncateRunes(a.LastError, 80)
		}
		return "出错了"
	case "waiting":
		return "等你看看"
	default:
		return "休息中"
	}
}

// ApprovalActions 审批卡最多两个按钮（对齐 permToApproval）。
func ApprovalActions(toolName string) []map[string]any {
	if toolName == "WorkspaceTrust" {
		return []map[string]any{
			{"k": "allow", "l": "信任并继续", "pri": 1},
			{"k": "deny", "l": "拒绝"},
		}
	}
	return []map[string]any{
		{"k": "allow", "l": "本次允许", "pri": 1},
		{"k": "deny", "l": "拒绝"},
	}
}

// ApprovalTitle 审批卡标题。
func ApprovalTitle(p permission.Public) string {
	if p.ToolName == "WorkspaceTrust" {
		sum := p.Summary
		if sum == "" {
			sum = p.ToolName
		}
		return truncateRunes("需要确认是否信任工作区："+sum, 160)
	}
	title := p.Meaning
	if title == "" {
		title = p.Summary
	}
	if title == "" {
		title = p.ToolName
	}
	if title == "" {
		title = "申请使用工具，需要你授权"
	}
	return truncateRunes(title, 160)
}

// TeamAgents 返回某工作组下的数字员工；teamID=0 表示未入组。
func (s *Service) TeamAgents(ctx context.Context, teamID int64) ([]store.ManagedAgent, error) {
	all, err := s.Store.ListManagedAgents(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]store.ManagedAgent, 0, len(all))
	for _, a := range all {
		if teamID == 0 {
			if a.FolderID == 0 {
				out = append(out, a)
			}
			continue
		}
		if a.FolderID == teamID {
			out = append(out, a)
		}
	}
	return out, nil
}

// EnsureTeamExists teamID=0 恒通过；否则校验 agent_folders 存在。
func (s *Service) EnsureTeamExists(ctx context.Context, teamID int64) error {
	if teamID == 0 {
		return nil
	}
	folders, err := s.Store.ListAgentFolders(ctx)
	if err != nil {
		return err
	}
	for _, f := range folders {
		if f.ID == teamID {
			return nil
		}
	}
	return fmt.Errorf("team not found")
}

// BuildTeamSnapshot 连接建立时的全队快照（agents + approvals）。
func (s *Service) BuildTeamSnapshot(ctx context.Context, teamID int64) (map[string]any, error) {
	agents, err := s.TeamAgents(ctx, teamID)
	if err != nil {
		return nil, err
	}
	occMap, _ := s.Store.ListOccupancyMap(ctx)
	pendingByConv := map[int64][]permission.Public{}
	if s.Perms != nil {
		for _, p := range s.Perms.Pending(0) {
			pendingByConv[p.ConvID] = append(pendingByConv[p.ConvID], p)
		}
	}

	agentRows := make([]map[string]any, 0, len(agents))
	approvals := make([]map[string]any, 0)
	for _, a := range agents {
		var occ *store.Occupancy
		if o, ok := occMap[a.ID]; ok {
			oc := o
			occ = &oc
		}
		tasks, _ := s.Store.AgentTasksByAgentID(ctx, "managed", strconv.FormatInt(a.ID, 10), "")
		pending := pendingByConv[a.ConversationID]
		hasPending := len(pending) > 0
		agentRows = append(agentRows, map[string]any{
			"agentId":     strconv.FormatInt(a.ID, 10),
			"state":       MapJellyState(a.Status, hasPending, occ),
			"currentTask": JellyCurrentTask(a, occ, tasks),
			"name":        a.Name,
		})
		for _, p := range pending {
			approvals = append(approvals, map[string]any{
				"approvalId": p.ID,
				"agentId":    strconv.FormatInt(a.ID, 10),
				"title":      ApprovalTitle(p),
				"actions":    ApprovalActions(p.ToolName),
			})
		}
	}
	return map[string]any{
		"type":      "snapshot",
		"teamId":    strconv.FormatInt(teamID, 10),
		"agents":    agentRows,
		"approvals": approvals,
	}, nil
}

// setManagedAgentStatus 写库并发布 agent.status（优先挂钩点）。
func (s *Service) setManagedAgentStatus(ctx context.Context, id int64, status, lastErr string, runMs int, convID int64) error {
	err := s.Store.SetManagedAgentStatus(ctx, id, status, lastErr, runMs, convID)
	if err != nil {
		return err
	}
	s.publishAgentStatus(ctx, id)
	return nil
}

// publishAgentStatus 推送当前员工状态到其工作组流。
func (s *Service) publishAgentStatus(ctx context.Context, agentID int64) {
	if s.TeamHub == nil || agentID <= 0 {
		return
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return
	}
	var occ *store.Occupancy
	if o, e := s.Store.GetOccupancy(ctx, agentID); e == nil {
		occ = o
	}
	hasPending := false
	if s.Perms != nil && a.ConversationID > 0 {
		hasPending = len(s.Perms.Pending(a.ConversationID)) > 0
	}
	tasks, _ := s.Store.AgentTasksByAgentID(ctx, "managed", strconv.FormatInt(agentID, 10), "")
	s.TeamHub.Publish(a.FolderID, "agent.status", map[string]any{
		"agentId":     strconv.FormatInt(agentID, 10),
		"state":       MapJellyState(a.Status, hasPending, occ),
		"currentTask": JellyCurrentTask(*a, occ, tasks),
		"name":        a.Name,
	})
}

// publishTaskProgress 任务进度事件。
func (s *Service) publishTaskProgress(ctx context.Context, agentID int64, taskID string, progress int, message string) {
	if s.TeamHub == nil || agentID <= 0 {
		return
	}
	teamID := s.teamIDOfAgent(ctx, agentID)
	s.TeamHub.Publish(teamID, "task.progress", map[string]any{
		"taskId":   taskID,
		"agentId":  strconv.FormatInt(agentID, 10),
		"progress": progress,
		"message":  message,
	})
}

// publishTaskDone 任务完成事件。
func (s *Service) publishTaskDone(ctx context.Context, agentID int64, taskID string) {
	if s.TeamHub == nil || agentID <= 0 {
		return
	}
	teamID := s.teamIDOfAgent(ctx, agentID)
	s.TeamHub.Publish(teamID, "task.done", map[string]any{
		"taskId":     taskID,
		"agentId":    strconv.FormatInt(agentID, 10),
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// publishTaskHandoff 工作流节点间员工交接（from/to 均为 agentId 字符串）。
func (s *Service) publishTaskHandoff(ctx context.Context, fromAgent, toAgent int64, taskID string) {
	if s.TeamHub == nil || fromAgent <= 0 || toAgent <= 0 || fromAgent == toAgent {
		return
	}
	// 以接收方所在工作组为准；若双方不同组则两边各推一份
	toTeam := s.teamIDOfAgent(ctx, toAgent)
	payload := map[string]any{
		"from":   strconv.FormatInt(fromAgent, 10),
		"to":     strconv.FormatInt(toAgent, 10),
		"taskId": taskID,
	}
	s.TeamHub.Publish(toTeam, "task.handoff", payload)
	fromTeam := s.teamIDOfAgent(ctx, fromAgent)
	if fromTeam != toTeam {
		s.TeamHub.Publish(fromTeam, "task.handoff", payload)
	}
}

// publishApprovalPending / publishApprovalResolved 授权事件。
func (s *Service) publishApprovalPending(ctx context.Context, agentID int64, p permission.Public) {
	if s.TeamHub == nil || agentID <= 0 {
		return
	}
	teamID := s.teamIDOfAgent(ctx, agentID)
	s.TeamHub.Publish(teamID, "approval.pending", map[string]any{
		"approvalId": p.ID,
		"agentId":    strconv.FormatInt(agentID, 10),
		"title":      ApprovalTitle(p),
		"actions":    ApprovalActions(p.ToolName),
	})
	// 同步触手 waiting
	s.publishAgentStatus(ctx, agentID)
}

func (s *Service) publishApprovalResolved(ctx context.Context, agentID int64, approvalID, action string) {
	if s.TeamHub == nil {
		return
	}
	teamID := int64(0)
	if agentID > 0 {
		teamID = s.teamIDOfAgent(ctx, agentID)
	}
	fields := map[string]any{
		"approvalId": approvalID,
		"action":     action,
	}
	if agentID > 0 {
		fields["agentId"] = strconv.FormatInt(agentID, 10)
	}
	s.TeamHub.Publish(teamID, "approval.resolved", fields)
	if agentID > 0 {
		s.publishAgentStatus(ctx, agentID)
	}
}

func (s *Service) teamIDOfAgent(ctx context.Context, agentID int64) int64 {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return 0
	}
	return a.FolderID
}

// agentIDByConv 会话 → 数字员工。
func (s *Service) agentIDByConv(ctx context.Context, convID int64) int64 {
	if convID <= 0 {
		return 0
	}
	id, _, err := s.Store.ManagedAgentStatusByConversation(ctx, convID)
	if err != nil {
		return 0
	}
	return id
}

// startTeamStreamBridge 订阅 permission.Hub，转发为 approval.* 团队事件。
func (s *Service) startTeamStreamBridge() {
	if s.Perms == nil || s.TeamHub == nil {
		return
	}
	ch := s.Perms.Subscribe()
	// requestID → agentID，resolved 时 enrichment
	type pendingMeta struct {
		agentID int64
	}
	meta := map[string]pendingMeta{}
	go func() {
		for ev := range ch {
			ctx := context.Background()
			switch ev.Kind {
			case "request":
				if ev.Req == nil {
					continue
				}
				aid := s.agentIDByConv(ctx, ev.Req.ConvID)
				if aid <= 0 {
					continue
				}
				meta[ev.Req.ID] = pendingMeta{agentID: aid}
				s.publishApprovalPending(ctx, aid, *ev.Req)
			case "resolved":
				if ev.Res == nil {
					continue
				}
				aid := meta[ev.Res.ID].agentID
				delete(meta, ev.Res.ID)
				action := ev.Res.Behavior
				if action == "" {
					action = "deny"
				}
				s.publishApprovalResolved(ctx, aid, ev.Res.ID, action)
			}
		}
	}()
	log.Printf("teamstream: permission bridge started")
}

// PublishExternalTaskReport 外部 POST /api/agents/tasks 上报时挂钩。
func (s *Service) PublishExternalTaskReport(ctx context.Context, r store.AgentTaskReport) {
	if s.TeamHub == nil {
		return
	}
	aid, err := strconv.ParseInt(strings.TrimSpace(r.AgentID), 10, 64)
	if err != nil || aid <= 0 {
		return
	}
	st := strings.ToLower(r.Status)
	switch st {
	case "done", "success", "completed":
		s.publishTaskDone(ctx, aid, r.TaskID)
	case "failed", "error":
		s.publishTaskProgress(ctx, aid, r.TaskID, r.Progress, r.Message)
		s.publishAgentStatus(ctx, aid)
	default:
		s.publishTaskProgress(ctx, aid, r.TaskID, r.Progress, r.Message)
	}
}
