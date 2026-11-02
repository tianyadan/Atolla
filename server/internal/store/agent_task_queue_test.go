package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestAgentTaskQueueEnqueuePauseClaim(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "tq.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := st.EnsureAgentTaskQueueSchema(ctx); err != nil {
		t.Fatal(err)
	}
	pos, err := st.NextAgentTaskPosition(ctx, 1)
	if err != nil || pos != 1 {
		t.Fatalf("pos=%d err=%v", pos, err)
	}
	id1, err := st.InsertAgentTaskQueue(ctx, AgentTaskQueueItem{
		AgentID: 1, Status: TaskRunning, Question: "A",
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, err := st.PauseAgentTaskRunning(ctx, id1, 1)
	if err != nil || !ok {
		t.Fatalf("pause ok=%v err=%v", ok, err)
	}
	id2, err := st.InsertAgentTaskQueue(ctx, AgentTaskQueueItem{
		AgentID: 1, Status: TaskQueued, Question: "B", Position: 1,
	})
	if err != nil || id2 <= 0 {
		t.Fatal(err)
	}
	next, err := st.ClaimPausedAgentTask(ctx, 1)
	if err != nil || next == nil || next.ID != id1 || !next.ResumeHint {
		t.Fatalf("claim paused %+v err=%v", next, err)
	}
	if ok, _ := st.CompleteAgentTaskRunning(ctx, next.ID, TaskDone, ""); !ok {
		t.Fatal("complete")
	}
	qnext, err := st.ClaimQueuedAgentTask(ctx, 1)
	if err != nil || qnext == nil || qnext.Question != "B" || qnext.ResumeHint {
		t.Fatalf("claim queued %+v err=%v", qnext, err)
	}
}

func TestAgentTaskQueueHold(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "tq2.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	_ = st.EnsureAgentTaskQueueSchema(ctx)
	if err := st.SetAgentTaskQueueHold(ctx, 9, true); err != nil {
		t.Fatal(err)
	}
	held, err := st.GetAgentTaskQueueHold(ctx, 9)
	if err != nil || !held {
		t.Fatalf("held=%v err=%v", held, err)
	}
}

func TestAgentTaskQueueExecutionCanOnlyBeginOnce(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "tq-execution.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	id, err := st.InsertAgentTaskQueue(ctx, AgentTaskQueueItem{
		AgentID: 7, Status: TaskRunning, Question: "只执行一次", Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := st.BeginAgentTaskExecution(ctx, id); err != nil || !ok {
		t.Fatalf("first begin ok=%v err=%v", ok, err)
	}
	if ok, err := st.BeginAgentTaskExecution(ctx, id); err != nil || ok {
		t.Fatalf("duplicate begin ok=%v err=%v", ok, err)
	}
	if ok, err := st.CompleteAgentTaskRunning(ctx, id, TaskDone, ""); err != nil || !ok {
		t.Fatalf("complete executing ok=%v err=%v", ok, err)
	}
	if ok, err := st.BeginAgentTaskExecution(ctx, id); err != nil || ok {
		t.Fatalf("completed task began again ok=%v err=%v", ok, err)
	}
}
