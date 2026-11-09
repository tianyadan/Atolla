package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/plugin/githubidea"
	"atolla/server/internal/store"
)

// GitHubIdeaDispatchView 是设置页使用的调度审计视图。
type GitHubIdeaDispatchView struct {
	ID                   int64     `json:"id"`
	ParentDispatchID     int64     `json:"parent_dispatch_id,omitempty"`
	SupersededByID       int64     `json:"superseded_by_id,omitempty"`
	SourceKey            string    `json:"source_key"`
	SourceURL            string    `json:"source_url"`
	TaskTitle            string    `json:"task_title"`
	TaskType             string    `json:"task_type"`
	RequiredRole         string    `json:"required_role"`
	Status               string    `json:"status"`
	ExecutionStatus      string    `json:"execution_status"`
	StatusReason         string    `json:"status_reason"`
	FailureReason        string    `json:"failure_reason,omitempty"`
	RecommendedAgentID   int64     `json:"recommended_agent_id,omitempty"`
	RecommendedAgentName string    `json:"recommended_agent_name,omitempty"`
	AssignedAgentID      int64     `json:"assigned_agent_id,omitempty"`
	AssignedAgentName    string    `json:"assigned_agent_name,omitempty"`
	QueueTaskID          int64     `json:"queue_task_id,omitempty"`
	Confidence           float64   `json:"confidence"`
	LLMUsed              bool      `json:"llm_used"`
	MatchReasons         []string  `json:"match_reasons"`
	Retryable            bool      `json:"retryable"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

func (s *Service) ListGitHubIdeaDispatches(ctx context.Context, limit int) ([]GitHubIdeaDispatchView, error) {
	rows, err := s.Store.ListTaskDispatches(ctx, "github_issue", limit)
	if err != nil {
		return nil, err
	}
	agents, err := s.Store.ListManagedAgents(ctx)
	if err != nil {
		return nil, err
	}
	agentNames := make(map[int64]string, len(agents))
	for _, agent := range agents {
		agentNames[agent.ID] = agent.Name
	}
	out := make([]GitHubIdeaDispatchView, 0, len(rows))
	for _, row := range rows {
		view := GitHubIdeaDispatchView{
			ID: row.ID, ParentDispatchID: row.ParentDispatchID, SupersededByID: row.SupersededByID,
			SourceKey: row.SourceKey, SourceURL: row.SourceURL, TaskTitle: row.TaskTitle,
			TaskType: row.TaskType, RequiredRole: row.RequiredRole, Status: row.Status,
			ExecutionStatus: row.Status, StatusReason: row.StatusReason, FailureReason: row.LastError,
			RecommendedAgentID: row.RecommendedAgentID, RecommendedAgentName: agentNames[row.RecommendedAgentID],
			AssignedAgentID: row.AssignedAgentID, AssignedAgentName: agentNames[row.AssignedAgentID],
			QueueTaskID: row.QueueTaskID, Confidence: row.Confidence, LLMUsed: row.LLMUsed,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		}
		var decision DispatchRecommendation
		if json.Unmarshal([]byte(row.DecisionJSON), &decision) == nil {
			view.MatchReasons = append(view.MatchReasons, decision.Classification.Reasons...)
			// 无候选时直接展示逐人拒绝原因，避免前端只看到笼统的“安全校验未通过”。
			view.MatchReasons = append(view.MatchReasons, dispatchRejectionReasonLines(decision.Rejected)...)
			if decision.Recommended != nil {
				view.MatchReasons = append(view.MatchReasons, decision.Recommended.Reasons...)
			}
			if decision.Reason != "" {
				view.MatchReasons = append(view.MatchReasons, decision.Reason)
			}
		}
		if len(view.MatchReasons) == 0 && row.StatusReason != "" {
			view.MatchReasons = []string{row.StatusReason}
		}
		if row.QueueTaskID > 0 {
			queueItem, queueErr := s.Store.GetAgentTaskQueueItem(ctx, row.QueueTaskID)
			if queueErr != nil {
				return nil, queueErr
			}
			if queueItem != nil {
				view.ExecutionStatus = queueItem.Status
				if queueItem.Status == store.TaskExecuting {
					view.ExecutionStatus = store.TaskRunning
				}
				if strings.TrimSpace(queueItem.ErrorText) != "" {
					view.FailureReason = queueItem.ErrorText
				}
			}
		}
		view.Retryable = row.SupersededByID == 0 && taskDispatchViewRetryable(row, view.ExecutionStatus)
		out = append(out, view)
	}
	return out, nil
}

func taskDispatchViewRetryable(row store.TaskDispatch, executionStatus string) bool {
	if row.Status == store.TaskDispatchPendingAssignment || row.Status == store.TaskDispatchFailed || row.Status == store.TaskDispatchCancelled {
		return true
	}
	return executionStatus == store.TaskFailed || executionStatus == store.TaskCancelled
}

// ReassignGitHubIdeaDispatch 对所选员工重新执行全部硬约束，再创建独立重试审计行并原子入队。
func (s *Service) ReassignGitHubIdeaDispatch(ctx context.Context, dispatchID, agentID int64) (*GitHubIdeaDispatchView, error) {
	if s.GitHubIdea == nil {
		return nil, fmt.Errorf("GitHub Idea 插件未初始化")
	}
	original, err := s.Store.GetTaskDispatch(ctx, dispatchID)
	if err != nil || original == nil {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("调度记录不存在")
	}
	if original.SourceType != "github_issue" || original.SupersededByID > 0 {
		return nil, fmt.Errorf("该调度记录不可重新分派")
	}
	views, err := s.ListGitHubIdeaDispatches(ctx, 200)
	if err != nil {
		return nil, err
	}
	retryable := false
	for _, view := range views {
		if view.ID == dispatchID {
			retryable = view.Retryable
			break
		}
	}
	if !retryable {
		return nil, fmt.Errorf("仅失败或待分派任务可重新分派")
	}
	var requiredCapabilities, optionalTags, requiredPermissions []string
	_ = json.Unmarshal([]byte(original.RequiredCapabilitiesJSON), &requiredCapabilities)
	_ = json.Unmarshal([]byte(original.OptionalTagsJSON), &optionalTags)
	_ = json.Unmarshal([]byte(original.RequiredPermissionsJSON), &requiredPermissions)
	config, err := s.GitHubIdea.Get(ctx)
	if err != nil {
		return nil, err
	}
	recommendation, err := s.RecommendTaskDispatch(ctx, DispatchTaskRequest{
		Title: original.TaskTitle, Body: original.TaskBody, TaskType: original.TaskType,
		RequiredRole: original.RequiredRole, RequiredCapabilities: requiredCapabilities,
		OptionalTags: optionalTags, RequiredPermissions: requiredPermissions,
		ExplicitAgentID: agentID, AllowedAgentIDs: config.AgentIDs, EnforceAllowedAgents: true,
	}, nil)
	if err != nil {
		return nil, err
	}
	if recommendation.Recommended == nil {
		detail := strings.Join(dispatchRejectionReasonLines(recommendation.Rejected), "；")
		if detail != "" {
			return nil, fmt.Errorf("所选数字员工未通过安全校验: %s（%s）", recommendation.Reason, detail)
		}
		return nil, fmt.Errorf("所选数字员工未通过安全校验: %s", recommendation.Reason)
	}
	decisionJSON, _ := json.Marshal(recommendation)
	retry, err := s.Store.CreateTaskDispatchManualRetry(ctx, original.ID, agentID, string(decisionJSON))
	if err != nil {
		return nil, err
	}
	question := buildGitHubDispatchRetryTask(retry)
	outcome, err := s.enqueueGitHubDispatchAtomic(ctx, retry.ID, agentID, question)
	if err != nil {
		_ = s.Store.MarkTaskDispatchPendingAssignment(ctx, retry.ID, "手动重新分派入队失败", err)
		return nil, err
	}
	repository, issueNumber := parseGitHubIssueSourceKey(retry.SourceKey)
	binding := githubidea.IdeaBinding{Repository: repository, IssueNumber: issueNumber, IdeaID: fmt.Sprintf("ISSUE-%d", issueNumber)}
	if err := s.GitHubIdea.CompleteIdea(fmt.Sprintf("manual-reassign#%d", retry.ID), strconv.FormatInt(outcome.Item.ID, 10), binding); err != nil {
		return nil, err
	}
	if outcome.Kickoff != nil {
		go s.autoRunClaimedTaskQueueItem(agentID, outcome.Kickoff)
	}
	views, err = s.ListGitHubIdeaDispatches(ctx, 200)
	if err != nil {
		return nil, err
	}
	for i := range views {
		if views[i].ID == retry.ID {
			return &views[i], nil
		}
	}
	return nil, fmt.Errorf("重新分派记录读取失败")
}

func dispatchRejectionReasonLines(rejected []DispatchRejection) []string {
	lines := make([]string, 0, len(rejected))
	for _, item := range rejected {
		if len(item.Reasons) == 0 {
			continue
		}
		name := strings.TrimSpace(item.AgentName)
		if name == "" {
			name = fmt.Sprintf("数字员工 #%d", item.AgentID)
		}
		lines = append(lines, name+"："+strings.Join(item.Reasons, "、"))
	}
	return lines
}

func buildGitHubDispatchRetryTask(dispatch *store.TaskDispatch) string {
	return fmt.Sprintf(`请根据以下 GitHub Issue 内容完成分析或开发。

标题：%s

内容：
%s

来源：%s
链接：%s`, strings.TrimSpace(dispatch.TaskTitle), limitGitHubIdeaText(dispatch.TaskBody, 32_000), dispatch.SourceKey, dispatch.SourceURL)
}

func parseGitHubIssueSourceKey(sourceKey string) (string, int) {
	index := strings.LastIndex(sourceKey, "#")
	if index <= 0 {
		return sourceKey, 0
	}
	number, _ := strconv.Atoi(sourceKey[index+1:])
	return sourceKey[:index], number
}
