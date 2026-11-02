package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"atolla/server/internal/store"
)

func TestBeginTaskQueueExecutionRejectsDuplicateAndCompletedTask(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "queue-service.db"))
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: st}
	ctx := context.Background()
	id, err := st.InsertAgentTaskQueue(ctx, store.AgentTaskQueueItem{
		AgentID: 12, Status: store.TaskRunning, Question: "只执行一次", Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	item, err := svc.beginTaskQueueExecution(ctx, 12, id)
	if err != nil || item == nil || item.Status != store.TaskExecuting {
		t.Fatalf("first dispatch item=%+v err=%v", item, err)
	}
	if _, err = svc.beginTaskQueueExecution(ctx, 12, id); !errors.Is(err, ErrTaskQueueDispatched) {
		t.Fatalf("duplicate dispatch err=%v", err)
	}
	if ok, err := st.CompleteAgentTaskRunning(ctx, id, store.TaskDone, ""); err != nil || !ok {
		t.Fatalf("complete ok=%v err=%v", ok, err)
	}
	if _, err = svc.beginTaskQueueExecution(ctx, 12, id); !errors.Is(err, ErrTaskQueueDispatched) {
		t.Fatalf("completed dispatch err=%v", err)
	}
}

func TestContinueTaskQueueDoesNotRedispatchExecutingTask(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "queue-continue.db"))
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: st}
	ctx := context.Background()
	id, err := st.InsertAgentTaskQueue(ctx, store.AgentTaskQueueItem{
		AgentID: 19, Status: store.TaskRunning, Question: "执行中任务", Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := st.BeginAgentTaskExecution(ctx, id); err != nil || !ok {
		t.Fatalf("begin ok=%v err=%v", ok, err)
	}
	item, err := svc.ContinueAgentTaskQueue(ctx, 19)
	if err != nil || item != nil {
		t.Fatalf("continue executing item=%+v err=%v", item, err)
	}
	view, err := svc.ListTaskQueue(ctx, 19)
	if err != nil || len(view.Items) != 1 || view.Items[0].Status != store.TaskRunning {
		t.Fatalf("normalized view=%+v err=%v", view, err)
	}
}
