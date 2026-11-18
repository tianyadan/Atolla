package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"atolla/server/internal/store"
)

type dispatchFallbackStub struct {
	calls int
	out   DispatchClassification
	err   error
}

func (s *dispatchFallbackStub) ClassifyDispatchTask(context.Context, DispatchTaskRequest) (DispatchClassification, error) {
	s.calls++
	return s.out, s.err
}

func TestClassifyDispatchTaskRulesBeforeLLM(t *testing.T) {
	fallback := &dispatchFallbackStub{out: DispatchClassification{TaskType: "design"}}
	got := ClassifyDispatchTask(context.Background(), DispatchTaskRequest{
		Title: "修复 Go 后端 API", Labels: []string{"能力:git.write", "权限:联网"},
	}, fallback)
	if got.TaskType != "backend" || got.RequiredRole != "后端" || got.Source != "rules" {
		t.Fatalf("unexpected classification: %+v", got)
	}
	if fallback.calls != 0 {
		t.Fatalf("rules matched but fallback calls=%d", fallback.calls)
	}
	if len(got.RequiredCapabilities) != 1 || got.RequiredCapabilities[0] != "git.write" {
		t.Fatalf("capabilities=%v", got.RequiredCapabilities)
	}
	if len(got.RequiredPermissions) != 1 || got.RequiredPermissions[0] != "network" {
		t.Fatalf("permissions=%v", got.RequiredPermissions)
	}
}

func TestClassifyDispatchTaskUsesStructuredLLMFallback(t *testing.T) {
	fallback := &dispatchFallbackStub{out: DispatchClassification{
		TaskType: "test", RequiredRole: "测试", OptionalTags: []string{"Playwright"}, Confidence: 0.72,
	}}
	got := ClassifyDispatchTask(context.Background(), DispatchTaskRequest{Title: "请处理这个需求"}, fallback)
	if fallback.calls != 1 || !got.LLMUsed || got.Source != "llm" || got.TaskType != "test" || got.NeedsManual {
		t.Fatalf("unexpected llm classification: calls=%d got=%+v", fallback.calls, got)
	}
	if got.Confidence != 0.72 || len(got.OptionalTags) != 1 || got.OptionalTags[0] != "playwright" {
		t.Fatalf("llm result not normalized: %+v", got)
	}
}

func TestClassifyDispatchTaskExplicitRoleSkipsLLM(t *testing.T) {
	fallback := &dispatchFallbackStub{err: errors.New("must not be called")}
	got := ClassifyDispatchTask(context.Background(), DispatchTaskRequest{RequiredRole: "Go 后端"}, fallback)
	if fallback.calls != 0 || got.Source != "explicit" || got.TaskType != "backend" || got.RequiredRole != "Go 后端" {
		t.Fatalf("explicit role classification: calls=%d got=%+v", fallback.calls, got)
	}
}

func TestClassifyDispatchTaskLLMFailureFallsBackToManual(t *testing.T) {
	fallback := &dispatchFallbackStub{err: errors.New("model unavailable")}
	got := ClassifyDispatchTask(context.Background(), DispatchTaskRequest{Title: "未知事项"}, fallback)
	if !got.NeedsManual || !got.LLMUsed || got.Source != "manual" || got.FallbackError != "model unavailable" {
		t.Fatalf("unexpected manual fallback: %+v", got)
	}
}

func TestClassifyDispatchTaskUnknownTypeWithoutConstraintsNeedsManual(t *testing.T) {
	got := ClassifyDispatchTask(context.Background(), DispatchTaskRequest{TaskType: "unknown-domain"}, nil)
	if !got.NeedsManual || got.Source != "manual" {
		t.Fatalf("unknown unconstrained type should need manual classification: %+v", got)
	}
}

func TestRankDispatchCandidatesFiltersAndScores(t *testing.T) {
	classification := DispatchClassification{
		TaskType: "backend", RequiredRole: "后端", RequiredCapabilities: []string{"git.write"},
		RequiredPermissions: []string{"write"}, OptionalTags: []string{"docker"},
	}
	agents := []DispatchAgentProfile{
		{ID: 20, Name: "匹配但较忙", JobRole: "后端", Status: "running", AcceptsTasks: true,
			Capabilities: []string{"git.write", "docker"}, Tags: []string{"docker"}, Permissions: map[string]bool{"write": true}, ActiveTasks: 4},
		{ID: 10, Name: "空闲但少标签", JobRole: "后端", Status: "idle", AcceptsTasks: true,
			Capabilities: []string{"git.write"}, Permissions: map[string]bool{"write": true}},
		{ID: 30, Name: "无写权限", JobRole: "后端", Status: "idle", AcceptsTasks: true,
			Capabilities: []string{"git.write", "docker"}, Permissions: map[string]bool{"write": false}},
		{ID: 40, Name: "岗位不符", JobRole: "前端", Status: "idle", AcceptsTasks: true,
			Capabilities: []string{"git.write", "docker"}, Permissions: map[string]bool{"write": true}},
	}
	got := RankDispatchCandidates(classification, agents, 0)
	if got.Recommended == nil || got.Recommended.AgentID != 20 {
		t.Fatalf("recommended=%+v alternatives=%+v", got.Recommended, got.Alternatives)
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].AgentID != 10 || len(got.Rejected) != 2 {
		t.Fatalf("unexpected decision: %+v", got)
	}
}

func TestRankDispatchCandidatesStableTieBreak(t *testing.T) {
	c := DispatchClassification{TaskType: "docs", RequiredRole: "文档"}
	agents := []DispatchAgentProfile{
		{ID: 9, Name: "九", JobRole: "文档", Status: "idle", AcceptsTasks: true, Permissions: map[string]bool{}},
		{ID: 3, Name: "三", JobRole: "文档", Status: "idle", AcceptsTasks: true, Permissions: map[string]bool{}},
	}
	got := RankDispatchCandidates(c, agents, 0)
	if got.Recommended == nil || got.Recommended.AgentID != 3 {
		t.Fatalf("stable order failed: %+v", got)
	}
}

func TestRankDispatchCandidatesExplicitAgentStillChecksSafety(t *testing.T) {
	c := DispatchClassification{TaskType: "ops", RequiredRole: "运维", RequiredPermissions: []string{"network"}}
	agents := []DispatchAgentProfile{
		{ID: 1, Name: "安全候选", JobRole: "运维", Status: "idle", AcceptsTasks: true, Permissions: map[string]bool{"network": true}},
		{ID: 2, Name: "指定但离线", JobRole: "运维", Status: "offline", AcceptsTasks: true, Permissions: map[string]bool{"network": true}},
	}
	unsafe := RankDispatchCandidates(c, agents, 2)
	if unsafe.Recommended != nil || !unsafe.NeedsManual || unsafe.Reason != "指定数字员工未通过安全校验" {
		t.Fatalf("unsafe explicit agent passed: %+v", unsafe)
	}
	safe := RankDispatchCandidates(c, agents, 1)
	if safe.Recommended == nil || safe.Recommended.AgentID != 1 || len(safe.Alternatives) != 0 {
		t.Fatalf("safe explicit agent not selected: %+v", safe)
	}
}

func TestRankDispatchCandidatesRejectsCapacityAndMissingAgent(t *testing.T) {
	c := DispatchClassification{TaskType: "backend", RequiredRole: "后端"}
	agents := []DispatchAgentProfile{{
		ID: 1, Name: "满载", JobRole: "后端", Status: "idle", AcceptsTasks: true,
		Permissions: map[string]bool{}, ActiveTasks: 2, MaxActive: 2,
	}}
	full := RankDispatchCandidates(c, agents, 1)
	if full.Recommended != nil || len(full.Rejected) != 1 {
		t.Fatalf("full agent passed: %+v", full)
	}
	missing := RankDispatchCandidates(c, agents, 99)
	if missing.Reason != "指定数字员工不存在" || len(missing.Rejected) != 1 {
		t.Fatalf("missing explicit agent: %+v", missing)
	}
}

func TestRankDispatchCandidatesUnknownPermissionIsDenied(t *testing.T) {
	c := ClassifyDispatchTask(context.Background(), DispatchTaskRequest{
		TaskType: "backend", RequiredPermissions: []string{"production_root"},
	}, nil)
	got := RankDispatchCandidates(c, []DispatchAgentProfile{{
		ID: 1, Name: "后端", JobRole: "Go 后端", Status: "idle", AcceptsTasks: true,
		Permissions: map[string]bool{"write": true},
	}}, 0)
	if got.Recommended != nil || len(got.Rejected) != 1 {
		t.Fatalf("unknown permission was silently allowed: %+v", got)
	}
}

func TestRecommendTaskDispatchEnforcesPluginAgentAllowlist(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "dispatch-engine.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.SQLDB().Close() })
	ctx := context.Background()
	role := "后端"
	firstID, err := st.CreateManagedAgent(ctx, store.ManagedAgentInput{Name: "一号", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := st.CreateManagedAgent(ctx, store.ManagedAgentInput{Name: "二号", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: st}
	got, err := svc.RecommendTaskDispatch(ctx, DispatchTaskRequest{
		TaskType: "backend", AllowedAgentIDs: []int64{secondID}, EnforceAllowedAgents: true,
	}, nil)
	if err != nil || got.Recommended == nil || got.Recommended.AgentID != secondID || got.Recommended.AgentID == firstID {
		t.Fatalf("allowlist decision=%+v err=%v", got, err)
	}
	empty, err := svc.RecommendTaskDispatch(ctx, DispatchTaskRequest{
		TaskType: "backend", EnforceAllowedAgents: true,
	}, nil)
	if err != nil || empty.Recommended != nil || !empty.NeedsManual {
		t.Fatalf("empty enforced allowlist decision=%+v err=%v", empty, err)
	}
}
