package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func newTaskDispatchTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "dispatch.db"))
	if err != nil {
		t.Fatalf("open dispatch store: %v", err)
	}
	t.Cleanup(func() { _ = st.SQLDB().Close() })
	return st
}

func TestTaskDispatchMigrationAndJobRoleRoundTrip(t *testing.T) {
	st := newTaskDispatchTestStore(t)
	ctx := context.Background()

	if ok, err := st.hasColumn(ctx, "managed_agents", "job_role"); err != nil || !ok {
		t.Fatalf("job_role migration ok=%v err=%v", ok, err)
	}
	if ok, err := st.hasTable(ctx, "task_dispatches"); err != nil || !ok {
		t.Fatalf("task_dispatches migration ok=%v err=%v", ok, err)
	}
	for _, indexName := range []string{
		"idx_task_dispatch_source",
		"idx_task_dispatch_status",
		"idx_task_dispatch_agent",
		"idx_task_dispatch_parent",
	} {
		var count int
		if err := st.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, indexName).Scan(&count); err != nil || count != 1 {
			t.Fatalf("dispatch index %s count=%d err=%v", indexName, count, err)
		}
	}

	role := "Go 后端"
	id, err := st.CreateManagedAgent(ctx, ManagedAgentInput{Name: "调度员工", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatalf("create managed agent: %v", err)
	}
	agent, err := st.GetManagedAgent(ctx, id)
	if err != nil || agent == nil || agent.JobRole != role {
		t.Fatalf("job role after create agent=%+v err=%v", agent, err)
	}

	updatedRole := "全栈"
	if err := st.UpdateManagedAgent(ctx, id, ManagedAgentInput{JobRole: &updatedRole}); err != nil {
		t.Fatalf("update job role: %v", err)
	}
	agent, err = st.GetManagedAgent(ctx, id)
	if err != nil || agent == nil || agent.JobRole != updatedRole {
		t.Fatalf("job role after update agent=%+v err=%v", agent, err)
	}
}

func TestRegisterTaskDispatchRevisionRules(t *testing.T) {
	st := newTaskDispatchTestStore(t)
	ctx := context.Background()
	base := TaskDispatchInput{
		SourceType: "github_issue", SourceKey: "tianyadan/atolla-idea#3",
		SourceRevision: "2026-11-08T10:00:00Z", EventAction: "opened",
		DeliveryID: "delivery-open-1", TaskTitle: "规则调度", TaskBody: "首次内容",
	}

	first, err := st.RegisterTaskDispatchRevision(ctx, base)
	if err != nil {
		t.Fatalf("register opened: %v", err)
	}
	if first.Duplicate || first.Dispatch == nil || first.Dispatch.Status != TaskDispatchPendingClassification {
		t.Fatalf("unexpected first registration: %+v", first)
	}
	if !first.Dispatch.RequiresReview {
		t.Fatal("new dispatch must require review by default")
	}

	duplicateInput := base
	duplicateInput.DeliveryID = "delivery-open-retry"
	duplicate, err := st.RegisterTaskDispatchRevision(ctx, duplicateInput)
	if err != nil {
		t.Fatalf("register duplicate: %v", err)
	}
	if !duplicate.Duplicate || duplicate.Dispatch == nil || duplicate.Dispatch.ID != first.Dispatch.ID {
		t.Fatalf("duplicate did not reuse first row: %+v", duplicate)
	}

	editedInput := base
	editedInput.SourceRevision = "2026-11-08T10:05:00Z"
	editedInput.EventAction = "edited"
	editedInput.DeliveryID = "delivery-edit"
	editedInput.TaskBody = "编辑后的内容"
	edited, err := st.RegisterTaskDispatchRevision(ctx, editedInput)
	if err != nil {
		t.Fatalf("register edited: %v", err)
	}
	if edited.Duplicate || edited.Dispatch.ParentDispatchID != first.Dispatch.ID {
		t.Fatalf("edited revision parent mismatch: %+v", edited)
	}
	old, err := getTaskDispatchByID(ctx, st.db, first.Dispatch.ID)
	if err != nil || old.Status != TaskDispatchSuperseded || old.SupersededByID != edited.Dispatch.ID {
		t.Fatalf("old pending revision not superseded: old=%+v err=%v", old, err)
	}

	// 已进入执行链的修订不能被重开事件篡改，只建立新的待分类修订。
	if _, err := st.db.ExecContext(ctx, `UPDATE task_dispatches SET status=? WHERE id=?`, TaskDispatchQueued, edited.Dispatch.ID); err != nil {
		t.Fatalf("mark queued: %v", err)
	}
	reopenedInput := base
	reopenedInput.SourceRevision = "2026-11-09T09:00:00Z"
	reopenedInput.EventAction = "reopened"
	reopenedInput.DeliveryID = "delivery-reopen"
	reopened, err := st.RegisterTaskDispatchRevision(ctx, reopenedInput)
	if err != nil {
		t.Fatalf("register reopened: %v", err)
	}
	queued, err := getTaskDispatchByID(ctx, st.db, edited.Dispatch.ID)
	if err != nil || queued.Status != TaskDispatchQueued || queued.SupersededByID != 0 {
		t.Fatalf("reopen changed executed revision: queued=%+v err=%v", queued, err)
	}
	if reopened.Dispatch.ParentDispatchID != edited.Dispatch.ID || reopened.Dispatch.Status != TaskDispatchPendingClassification {
		t.Fatalf("unexpected reopened revision: %+v", reopened.Dispatch)
	}

	var count int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM task_dispatches`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("dispatch count=%d err=%v", count, err)
	}
}

func TestTaskDispatchStateTransitions(t *testing.T) {
	allowed := [][2]string{
		{TaskDispatchPendingClassification, TaskDispatchPendingAssignment},
		{TaskDispatchPendingAssignment, TaskDispatchPendingConfirmation},
		{TaskDispatchPendingAssignment, TaskDispatchDispatching},
		{TaskDispatchPendingConfirmation, TaskDispatchDispatching},
		{TaskDispatchDispatching, TaskDispatchQueued},
		{TaskDispatchQueued, TaskDispatchRunning},
		{TaskDispatchRunning, TaskDispatchCompleted},
		{TaskDispatchFailed, TaskDispatchPendingAssignment},
	}
	for _, pair := range allowed {
		if !CanTransitionTaskDispatch(pair[0], pair[1]) {
			t.Fatalf("expected transition %s -> %s", pair[0], pair[1])
		}
	}
	for _, pair := range [][2]string{
		{TaskDispatchPendingClassification, TaskDispatchQueued},
		{TaskDispatchPendingConfirmation, TaskDispatchRunning},
		{TaskDispatchCompleted, TaskDispatchRunning},
		{TaskDispatchSuperseded, TaskDispatchPendingAssignment},
	} {
		if CanTransitionTaskDispatch(pair[0], pair[1]) {
			t.Fatalf("unexpected transition %s -> %s", pair[0], pair[1])
		}
	}
}

func TestEnqueueTaskDispatchAtomic(t *testing.T) {
	st := newTaskDispatchTestStore(t)
	ctx := context.Background()
	role := "后端"
	agentID, err := st.CreateManagedAgent(ctx, ManagedAgentInput{Name: "后端员工", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	autoReview := false
	registration, err := st.RegisterTaskDispatchRevision(ctx, TaskDispatchInput{
		SourceType: "github_issue", SourceKey: "acme/ideas#7", SourceRevision: "rev-1",
		EventAction: "opened", TaskTitle: "修复后端", RequiresReview: &autoReview,
	})
	if err != nil {
		t.Fatal(err)
	}
	dispatch, err := st.RecordTaskDispatchRecommendation(ctx, registration.Dispatch.ID, TaskDispatchRecommendationInput{
		TaskType: "backend", RequiredRole: "后端", RequiredCapabilitiesJSON: `[]`,
		OptionalTagsJSON: `[]`, RequiredPermissionsJSON: `["write"]`, RecommendedAgentID: agentID,
		CandidatesJSON: `[{"agent_id":1}]`, DecisionJSON: `{"reason":"matched"}`, Confidence: 0.9,
	})
	if err != nil || dispatch.Status != TaskDispatchPendingAssignment {
		t.Fatalf("record recommendation dispatch=%+v err=%v", dispatch, err)
	}
	otherID, err := st.CreateManagedAgent(ctx, ManagedAgentInput{Name: "未推荐员工", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnqueueTaskDispatchAtomic(ctx, dispatch.ID, otherID, "绕过推荐", ""); err == nil {
		t.Fatal("atomic enqueue must reject an agent that was not validated")
	}
	item, err := st.EnqueueTaskDispatchAtomic(ctx, dispatch.ID, agentID, "执行 GitHub Issue", "")
	if err != nil || item == nil || item.AgentID != agentID || item.Status != TaskQueued {
		t.Fatalf("atomic enqueue item=%+v err=%v", item, err)
	}
	queued, err := getTaskDispatchByID(ctx, st.db, dispatch.ID)
	if err != nil || queued.Status != TaskDispatchQueued || queued.QueueTaskID != item.ID || queued.AssignedAgentID != agentID {
		t.Fatalf("queued dispatch=%+v err=%v", queued, err)
	}
	if _, err := st.EnqueueTaskDispatchAtomic(ctx, dispatch.ID, agentID, "重复任务", ""); err == nil {
		t.Fatal("duplicate atomic enqueue should fail")
	}
	var count int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_task_queue WHERE agent_id=?`, agentID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("queue count=%d err=%v", count, err)
	}
}

func TestEnqueueTaskDispatchAtomicRejectsReviewAndFullQueue(t *testing.T) {
	st := newTaskDispatchTestStore(t)
	ctx := context.Background()
	role := "后端"
	agentID, err := st.CreateManagedAgent(ctx, ManagedAgentInput{Name: "满载员工", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	register := func(key string, review bool) *TaskDispatch {
		t.Helper()
		reg, regErr := st.RegisterTaskDispatchRevision(ctx, TaskDispatchInput{
			SourceType: "github_issue", SourceKey: key, SourceRevision: "rev-1",
			EventAction: "opened", TaskTitle: key, RequiresReview: &review,
		})
		if regErr != nil {
			t.Fatal(regErr)
		}
		out, recErr := st.RecordTaskDispatchRecommendation(ctx, reg.Dispatch.ID, TaskDispatchRecommendationInput{
			TaskType: "backend", RequiredRole: "后端", RecommendedAgentID: agentID,
		})
		if recErr != nil {
			t.Fatal(recErr)
		}
		return out
	}
	reviewDispatch := register("acme/ideas#review", true)
	if _, err := st.EnqueueTaskDispatchAtomic(ctx, reviewDispatch.ID, agentID, "不能自动执行", ""); err == nil {
		t.Fatal("review-required dispatch should not enqueue")
	}
	for i := 0; i < TaskQueueMaxActive; i++ {
		if _, err := st.InsertAgentTaskQueue(ctx, AgentTaskQueueItem{
			AgentID: agentID, Status: TaskQueued, Question: "占位", Position: i + 1, CreatedAt: time.Now().UTC(),
		}); err != nil {
			t.Fatal(err)
		}
	}
	fullDispatch := register("acme/ideas#full", false)
	if _, err := st.EnqueueTaskDispatchAtomic(ctx, fullDispatch.ID, agentID, "队列已满", ""); err == nil {
		t.Fatal("full queue should reject atomic enqueue")
	}
	stillPending, err := getTaskDispatchByID(ctx, st.db, fullDispatch.ID)
	if err != nil || stillPending.Status != TaskDispatchPendingAssignment || stillPending.QueueTaskID != 0 {
		t.Fatalf("failed enqueue must remain pending: dispatch=%+v err=%v", stillPending, err)
	}
}

func TestCreateTaskDispatchManualRetryPreservesOriginalAudit(t *testing.T) {
	st := newTaskDispatchTestStore(t)
	ctx := context.Background()
	role := "后端"
	agentID, err := st.CreateManagedAgent(ctx, ManagedAgentInput{Name: "重试员工", Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	auto := false
	registration, err := st.RegisterTaskDispatchRevision(ctx, TaskDispatchInput{
		SourceType: "github_issue", SourceKey: "acme/ideas#retry", SourceRevision: "rev-1",
		EventAction: "opened", TaskTitle: "失败任务", RequiresReview: &auto,
	})
	if err != nil {
		t.Fatal(err)
	}
	original, err := st.RecordTaskDispatchRecommendation(ctx, registration.Dispatch.ID, TaskDispatchRecommendationInput{
		TaskType: "backend", RequiredRole: "后端", RecommendedAgentID: agentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	queued, err := st.EnqueueTaskDispatchAtomic(ctx, original.ID, agentID, "第一次执行", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.ExecContext(ctx, `UPDATE agent_task_queue SET status=?, error_text=? WHERE id=?`, TaskFailed, "执行失败", queued.ID); err != nil {
		t.Fatal(err)
	}
	retry, err := st.CreateTaskDispatchManualRetry(ctx, original.ID, agentID, `{"manual":true}`)
	if err != nil {
		t.Fatal(err)
	}
	if retry.ParentDispatchID != original.ID || retry.Status != TaskDispatchPendingAssignment || retry.EventAction != "manual_reassign" {
		t.Fatalf("retry=%+v", retry)
	}
	kept, err := st.GetTaskDispatch(ctx, original.ID)
	if err != nil || kept.Status != TaskDispatchQueued || kept.SupersededByID != retry.ID || kept.QueueTaskID != queued.ID {
		t.Fatalf("original audit changed: original=%+v err=%v", kept, err)
	}
	items, err := st.ListTaskDispatches(ctx, "github_issue", 10)
	if err != nil || len(items) != 2 || items[0].ID != retry.ID {
		t.Fatalf("history=%+v err=%v", items, err)
	}
}
