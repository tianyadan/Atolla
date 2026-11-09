package service

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"atolla/server/internal/store"
)

func TestListGitHubIdeaDispatchesShowsRejectedAgentReason(t *testing.T) {
	ctx := context.Background()
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "dispatch-view.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.SQLDB().Close() })
	agentID, err := st.CreateManagedAgent(ctx, store.ManagedAgentInput{Name: "未配置岗位员工", Engine: "codex"})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	review := false
	registered, err := st.RegisterTaskDispatchRevision(ctx, store.TaskDispatchInput{
		SourceType: "github_issue", SourceKey: "acme/ideas#1", SourceRevision: "rev-1",
		EventAction: "opened", TaskTitle: "前端任务", RequiresReview: &review,
	})
	if err != nil {
		t.Fatalf("register dispatch: %v", err)
	}
	decision := DispatchRecommendation{
		Classification: DispatchClassification{TaskType: "frontend", RequiredRole: "前端"},
		Rejected:       []DispatchRejection{{AgentID: agentID, AgentName: "未配置岗位员工", Reasons: []string{"岗位不匹配"}}},
		NeedsManual:    true,
		Reason:         "没有满足岗位、能力、权限和容量要求的数字员工",
	}
	decisionJSON, _ := json.Marshal(decision)
	_, err = st.RecordTaskDispatchRecommendation(ctx, registered.Dispatch.ID, store.TaskDispatchRecommendationInput{
		TaskType: "frontend", RequiredRole: "前端", DecisionJSON: string(decisionJSON), StatusReason: decision.Reason,
	})
	if err != nil {
		t.Fatalf("record recommendation: %v", err)
	}
	views, err := (&Service{Store: st}).ListGitHubIdeaDispatches(ctx, 10)
	if err != nil || len(views) != 1 {
		t.Fatalf("list dispatches=%+v err=%v", views, err)
	}
	joined := strings.Join(views[0].MatchReasons, " | ")
	if !strings.Contains(joined, "未配置岗位员工：岗位不匹配") {
		t.Fatalf("match reasons %q do not expose rejected agent reason", joined)
	}
}
