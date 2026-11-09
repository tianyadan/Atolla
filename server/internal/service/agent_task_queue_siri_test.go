package service

import (
	"context"
	"path/filepath"
	"testing"

	"atolla/server/internal/store"
)

func TestSiriTaskEnqueueRespectsAgentQueueState(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "siri-task-queue.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	svc := &Service{
		Store: st,
		runs:  map[int64]*managedRun{},
	}

	newAgent := func(name string) int64 {
		t.Helper()
		id, createErr := st.CreateManagedAgent(ctx, store.ManagedAgentInput{Name: name, Engine: "codex"})
		if createErr != nil {
			t.Fatal(createErr)
		}
		return id
	}

	t.Run("idle starts the queued task", func(t *testing.T) {
		agentID := newAgent("空闲数字人")
		out, enqueueErr := svc.EnqueueAgentTaskEx(ctx, agentID, "执行空闲任务", nil)
		if enqueueErr != nil {
			t.Fatal(enqueueErr)
		}
		if out.Kickoff == nil || out.Item == nil || out.Item.Status != store.TaskRunning {
			t.Fatalf("idle enqueue should claim immediately: %+v", out)
		}
	})

	t.Run("busy keeps the task queued", func(t *testing.T) {
		agentID := newAgent("忙碌数字人")
		svc.runs[agentID] = &managedRun{}
		out, enqueueErr := svc.EnqueueAgentTaskEx(ctx, agentID, "等待当前任务完成", nil)
		if enqueueErr != nil {
			t.Fatal(enqueueErr)
		}
		if out.Kickoff != nil || out.Item == nil || out.Item.Status != store.TaskQueued {
			t.Fatalf("busy enqueue must stay queued: %+v", out)
		}
	})

	t.Run("paused queue does not start", func(t *testing.T) {
		agentID := newAgent("暂停数字人")
		if holdErr := st.SetAgentTaskQueueHold(ctx, agentID, true); holdErr != nil {
			t.Fatal(holdErr)
		}
		out, enqueueErr := svc.EnqueueAgentTaskEx(ctx, agentID, "等待恢复队列", nil)
		if enqueueErr != nil {
			t.Fatal(enqueueErr)
		}
		if out.Kickoff != nil || out.Item == nil || out.Item.Status != store.TaskQueued {
			t.Fatalf("held enqueue must stay queued: %+v", out)
		}
	})

	t.Run("approval wait does not interrupt the active run", func(t *testing.T) {
		agentID := newAgent("等待授权数字人")
		// 等待授权仍属于当前运行回合，runs 中保留占位，Siri 入队不得抢占。
		svc.runs[agentID] = &managedRun{}
		out, enqueueErr := svc.EnqueueAgentTaskEx(ctx, agentID, "授权后继续", nil)
		if enqueueErr != nil {
			t.Fatal(enqueueErr)
		}
		if out.Kickoff != nil || out.Item == nil || out.Item.Status != store.TaskQueued {
			t.Fatalf("approval enqueue must stay queued: %+v", out)
		}
	})
}
