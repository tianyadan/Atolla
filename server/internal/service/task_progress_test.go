package service

import (
	"context"
	"testing"
)

func TestTaskProgressNoMidJump(t *testing.T) {
	tp := &TaskProgress{
		taskID: "t1",
		name:   "demo",
		phase:  TaskPhasePlanning,
	}
	tp.SetPlan(context.Background(), []string{"A", "B", "C", "D"})
	if tp.idx != 0 || tp.steps[0].Status != TaskStepActive {
		t.Fatalf("want step0 active, idx=%d status=%s", tp.idx, tp.steps[0].Status)
	}
	for i := 1; i < 4; i++ {
		if tp.steps[i].Status != TaskStepPending {
			t.Fatalf("step %d want pending got %s", i, tp.steps[i].Status)
		}
	}
	// 长跑期间反复 Activate(0) 不得跳到中间
	tp.Activate(context.Background(), 0, "")
	if tp.idx != 0 {
		t.Fatalf("still want 0, got %d", tp.idx)
	}
	snap := tp.Snapshot("")
	if snap.Progress < 5 || snap.Progress > 20 {
		t.Fatalf("running progress should stay low, got %d", snap.Progress)
	}
	tp.done(context.Background(), "ok")
	if tp.phase != TaskPhaseDone || tp.Snapshot("").Progress != 100 {
		t.Fatalf("done snapshot %+v", tp.Snapshot(""))
	}
}

func TestTaskProgressCompleteThrough(t *testing.T) {
	tp := &TaskProgress{taskID: "t2", name: "collab", phase: TaskPhasePlanning}
	tp.SetPlan(context.Background(), []string{"准备", "整合甲", "整合乙", "汇总"})
	tp.CompleteThrough(context.Background(), 0, "")
	if tp.idx != 1 || tp.steps[0].Status != TaskStepDone || tp.steps[1].Status != TaskStepActive {
		t.Fatalf("after through0: idx=%d s0=%s s1=%s", tp.idx, tp.steps[0].Status, tp.steps[1].Status)
	}
	tp.CompleteThrough(context.Background(), 1, "")
	if tp.idx != 2 {
		t.Fatalf("want idx 2 got %d", tp.idx)
	}
}

func TestParseTaskPlanSnapshotCompat(t *testing.T) {
	snap := ParseTaskPlanSnapshot(map[string]any{
		"steps":        []any{"一", "二", "三"},
		"current_step": float64(1),
	}, "running", 40, "二")
	if len(snap.Steps) != 3 || snap.Steps[1].Status != TaskStepActive || snap.Steps[0].Status != TaskStepDone {
		t.Fatalf("%+v", snap.Steps)
	}
}
