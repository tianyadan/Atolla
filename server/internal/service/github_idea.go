package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/plugin/githubidea"
	"atolla/server/internal/store"
)

// HandleGitHubIdeaEvent 校验 Webhook、登记来源修订、规则调度并原子写入现有任务队列。
func (s *Service) HandleGitHubIdeaEvent(ctx context.Context, deliveryID, event, signature string, body []byte) (any, error) {
	if s.GitHubIdea == nil {
		return nil, fmt.Errorf("GitHub Idea 插件未初始化")
	}
	prepared, err := s.GitHubIdea.PrepareEvent(ctx, githubidea.EventInput{
		DeliveryID: deliveryID, Event: event, Signature: signature, Body: body,
	})
	if err != nil {
		_ = s.GitHubIdea.RecordError(err.Error())
		return nil, err
	}
	return s.handlePreparedGitHubIdeaEvent(ctx, prepared)
}

func (s *Service) handlePreparedGitHubIdeaEvent(ctx context.Context, prepared githubidea.PreparedEvent) (any, error) {
	dispatched := 0
	duplicates := 0
	pendingAssignment := 0
	var dispatchErrors []error
	for _, idea := range prepared.Ideas {
		requiresReview := false // GitHub Idea 既有行为是可信插件自动入队；危险命令仍走统一权限网关。
		registration, registerErr := s.Store.RegisterTaskDispatchRevision(ctx, store.TaskDispatchInput{
			SourceType: "github_issue", SourceKey: githubIssueSourceKey(prepared),
			SourceRevision: prepared.IssueRevision, EventAction: prepared.Action,
			DeliveryID: prepared.DeliveryID, SourceURL: prepared.IssueURL,
			TaskTitle: idea.Title, TaskBody: idea.Content, Priority: githubIssuePriority(prepared.Labels),
			DeadlineAt: prepared.DeadlineAt, RequiresReview: &requiresReview,
		})
		if registerErr != nil {
			dispatchErrors = append(dispatchErrors, registerErr)
			continue
		}
		dispatch := registration.Dispatch
		if dispatch == nil {
			dispatchErrors = append(dispatchErrors, fmt.Errorf("Idea %s 调度记录为空", idea.ID))
			continue
		}
		dedupKey := githubIdeaDedupKey(prepared, idea)
		binding := githubidea.IdeaBinding{Repository: prepared.Repository, IssueNumber: prepared.IssueNumber, IdeaID: idea.ID}
		if registration.Duplicate && dispatch.Status != store.TaskDispatchPendingClassification && dispatch.Status != store.TaskDispatchPendingAssignment {
			if dispatch.QueueTaskID > 0 {
				if err := s.GitHubIdea.CompleteIdea(dedupKey, strconv.FormatInt(dispatch.QueueTaskID, 10), binding); err != nil {
					dispatchErrors = append(dispatchErrors, fmt.Errorf("Idea %s 恢复队列绑定失败: %w", idea.ID, err))
					continue
				}
				s.kickoffGitHubIdeaQueueIfIdle(ctx, dispatch.AssignedAgentID)
			}
			duplicates++
			continue
		}

		explicitAgentID := githubIssueExplicitAgentID(prepared.Labels)
		recommendation, recommendErr := s.RecommendTaskDispatch(ctx, DispatchTaskRequest{
			Title: idea.Title, Body: idea.Content, Labels: prepared.Labels,
			ExplicitAgentID: explicitAgentID, AllowedAgentIDs: prepared.AgentIDs, EnforceAllowedAgents: true,
		}, s.DispatchClassifier)
		if recommendErr != nil {
			_ = s.Store.MarkTaskDispatchPendingAssignment(ctx, dispatch.ID, "调度数据读取失败", recommendErr)
			dispatchErrors = append(dispatchErrors, recommendErr)
			continue
		}
		recommendedID := int64(0)
		if recommendation.Recommended != nil {
			recommendedID = recommendation.Recommended.AgentID
		}
		candidatesJSON, _ := json.Marshal(dispatchCandidateSnapshot(recommendation))
		decisionJSON, _ := json.Marshal(recommendation)
		requiredCapsJSON, _ := json.Marshal(recommendation.Classification.RequiredCapabilities)
		optionalTagsJSON, _ := json.Marshal(recommendation.Classification.OptionalTags)
		requiredPermissionsJSON, _ := json.Marshal(recommendation.Classification.RequiredPermissions)
		statusReason := recommendation.Reason
		if recommendation.Recommended != nil {
			statusReason = "推荐数字员工: " + recommendation.Recommended.AgentName
		}
		dispatch, err := s.Store.RecordTaskDispatchRecommendation(ctx, dispatch.ID, store.TaskDispatchRecommendationInput{
			TaskType: recommendation.Classification.TaskType, RequiredRole: recommendation.Classification.RequiredRole,
			RequiredCapabilitiesJSON: string(requiredCapsJSON), OptionalTagsJSON: string(optionalTagsJSON),
			RequiredPermissionsJSON: string(requiredPermissionsJSON), RecommendedAgentID: recommendedID,
			CandidatesJSON: string(candidatesJSON), DecisionJSON: string(decisionJSON),
			Confidence: recommendation.Classification.Confidence, LLMUsed: recommendation.Classification.LLMUsed,
			StatusReason: statusReason,
		})
		if err != nil {
			recovered, recoverErr := s.recoverConcurrentGitHubIdeaDispatch(ctx, registration.Dispatch.ID, dedupKey, binding)
			if recovered {
				if recoverErr != nil {
					dispatchErrors = append(dispatchErrors, recoverErr)
				} else {
					duplicates++
				}
				continue
			}
			_ = s.Store.MarkTaskDispatchPendingAssignment(ctx, registration.Dispatch.ID, "保存调度建议失败", err)
			dispatchErrors = append(dispatchErrors, err)
			continue
		}
		if recommendation.Recommended == nil {
			pendingAssignment++
			continue
		}

		agentID := recommendation.Recommended.AgentID
		question := buildGitHubIdeaTask(prepared, idea)
		out, queueErr := s.enqueueGitHubDispatchAtomic(ctx, dispatch.ID, agentID, question)
		if queueErr != nil {
			recovered, recoverErr := s.recoverConcurrentGitHubIdeaDispatch(ctx, dispatch.ID, dedupKey, binding)
			if recovered {
				if recoverErr != nil {
					dispatchErrors = append(dispatchErrors, recoverErr)
				} else {
					duplicates++
				}
				continue
			}
			_ = s.Store.MarkTaskDispatchPendingAssignment(ctx, dispatch.ID, "原子入队失败，等待重新分派", queueErr)
			pendingAssignment++
			continue
		}
		taskID := ""
		if out.Item != nil {
			taskID = strconv.FormatInt(out.Item.ID, 10)
		}
		if completeErr := s.GitHubIdea.CompleteIdea(dedupKey, taskID, binding); completeErr != nil {
			dispatchErrors = append(dispatchErrors, fmt.Errorf("Idea %s 去重状态保存失败: %w", idea.ID, completeErr))
			continue
		}
		// 先持久化任务与 Markdown 的绑定，再启动执行，避免极短任务先结束而错过回写。
		if out.Kickoff != nil {
			go s.autoRunClaimedTaskQueueItem(agentID, out.Kickoff)
		}
		dispatched++
	}
	if len(dispatchErrors) > 0 {
		err := errors.Join(dispatchErrors...)
		_ = s.GitHubIdea.RecordError(err.Error())
		return map[string]any{
			"accepted": len(prepared.Ideas), "dispatched": dispatched, "duplicates": duplicates,
			"pending_assignment": pendingAssignment,
		}, err
	}
	_ = s.GitHubIdea.RecordSyncSuccess(time.Now())
	return map[string]any{
		"accepted": len(prepared.Ideas), "dispatched": dispatched, "duplicates": duplicates,
		"pending_assignment": pendingAssignment,
		"repository":         prepared.Repository, "issue": prepared.IssueNumber,
	}, nil
}

// recoverConcurrentGitHubIdeaDispatch 将并发请求已成功入队后的状态冲突视为幂等命中。
func (s *Service) recoverConcurrentGitHubIdeaDispatch(
	ctx context.Context,
	dispatchID int64,
	dedupKey string,
	binding githubidea.IdeaBinding,
) (bool, error) {
	current, err := s.Store.GetTaskDispatch(ctx, dispatchID)
	if err != nil || current == nil || current.QueueTaskID <= 0 {
		return false, err
	}
	if err := s.GitHubIdea.CompleteIdea(dedupKey, strconv.FormatInt(current.QueueTaskID, 10), binding); err != nil {
		return true, fmt.Errorf("Idea %s 恢复并发队列绑定失败: %w", binding.IdeaID, err)
	}
	s.kickoffGitHubIdeaQueueIfIdle(ctx, current.AssignedAgentID)
	return true, nil
}

func (s *Service) enqueueGitHubDispatchAtomic(ctx context.Context, dispatchID, agentID int64, question string) (EnqueueOutcome, error) {
	unlock := s.taskQueueLock(agentID)
	defer unlock()
	item, err := s.Store.EnqueueTaskDispatchAtomic(ctx, dispatchID, agentID, question, "")
	if err != nil {
		return EnqueueOutcome{}, err
	}
	kickoff := s.claimNextIfIdleLocked(ctx, agentID)
	if kickoff != nil && item != nil && kickoff.ID == item.ID {
		item = kickoff
	}
	return EnqueueOutcome{Item: item, Kickoff: kickoff}, nil
}

func (s *Service) kickoffGitHubIdeaQueueIfIdle(ctx context.Context, agentID int64) {
	if agentID <= 0 {
		return
	}
	unlock := s.taskQueueLock(agentID)
	kickoff := s.claimNextIfIdleLocked(ctx, agentID)
	unlock()
	if kickoff != nil {
		go s.autoRunClaimedTaskQueueItem(agentID, kickoff)
	}
}

// writeBackGitHubIdeaTask 在队列终态后异步回写，不阻塞下一任务调度。
func (s *Service) writeBackGitHubIdeaTask(taskID int64, status, reason string) {
	if s.GitHubIdea == nil || taskID <= 0 {
		return
	}
	go func() {
		id := strconv.FormatInt(taskID, 10)
		binding, claimed, err := s.GitHubIdea.ClaimWriteback(id, status)
		if err != nil || !claimed {
			if err != nil {
				_ = s.GitHubIdea.RecordError(err.Error())
			}
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		err = s.GitHubIdea.WriteBackStatus(ctx, binding, status, reason)
		_ = s.GitHubIdea.FinishWriteback(id, err == nil)
		if err != nil {
			_ = s.GitHubIdea.RecordError(fmt.Sprintf("Idea %s 状态回写失败: %v", binding.IdeaID, err))
		}
	}()
}

func githubIssueSourceKey(event githubidea.PreparedEvent) string {
	return strings.ToLower(strings.TrimSpace(event.Repository)) + "#" + strconv.Itoa(event.IssueNumber)
}

func githubIdeaDedupKey(event githubidea.PreparedEvent, idea githubidea.Idea) string {
	return strings.ToLower(event.Repository) + "#" + strings.ToLower(idea.ID) + "#" + strings.ToLower(event.IssueRevision)
}

func githubIssuePriority(labels []string) string {
	for _, label := range labels {
		switch strings.ToLower(strings.TrimSpace(label)) {
		case "priority:critical", "priority:urgent", "紧急", "p0":
			return "urgent"
		case "priority:high", "高优先级", "p1":
			return "high"
		case "priority:low", "低优先级", "p3":
			return "low"
		}
	}
	return "normal"
}

func githubIssueExplicitAgentID(labels []string) int64 {
	for _, raw := range labels {
		label := strings.TrimSpace(raw)
		lower := strings.ToLower(label)
		for _, prefix := range []string{"agent:", "agent-id:", "数字员工:"} {
			if strings.HasPrefix(lower, prefix) {
				id, _ := strconv.ParseInt(strings.TrimSpace(label[len(prefix):]), 10, 64)
				if id > 0 {
					return id
				}
			}
		}
	}
	return 0
}

func dispatchCandidateSnapshot(recommendation DispatchRecommendation) []DispatchCandidate {
	result := make([]DispatchCandidate, 0, len(recommendation.Alternatives)+1)
	if recommendation.Recommended != nil {
		result = append(result, *recommendation.Recommended)
	}
	return append(result, recommendation.Alternatives...)
}

func buildGitHubIdeaTask(event githubidea.PreparedEvent, idea githubidea.Idea) string {
	title := strings.TrimSpace(idea.Title)
	if title == "" {
		title = strings.TrimSpace(event.IssueTitle)
	}
	return fmt.Sprintf(`请根据以下 GitHub Issue 内容完成分析或开发。

标题：%s

内容：
%s

来源：%s Issue #%d
链接：%s
Idea ID：%s`, title, limitGitHubIdeaText(idea.Content, 32_000),
		event.Repository, event.IssueNumber, event.IssueURL, idea.ID)
}

func limitGitHubIdeaText(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max] + "\n\n[内容已截断]"
}
