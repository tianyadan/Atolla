package service

import (
	"testing"

	"atolla/server/internal/permission"
	"atolla/server/internal/store"
)

func TestMapJellyState(t *testing.T) {
	if MapJellyState("running", false, nil) != jellyWorking {
		t.Fatal("running → working")
	}
	if MapJellyState("idle", true, nil) != jellyWaiting {
		t.Fatal("pending approval → waiting")
	}
	if MapJellyState("idle", false, &store.Occupancy{SourceType: SourceWorkflow}) != jellyWorking {
		t.Fatal("workflow occupancy → working")
	}
	if MapJellyState("error", false, nil) != jellyError {
		t.Fatal("error")
	}
	if MapJellyState("compressing", false, nil) != jellyWorking {
		t.Fatal("compressing → working")
	}
}

func TestJellyCurrentTask(t *testing.T) {
	a := store.ManagedAgent{Status: "idle", Name: "A"}
	if JellyCurrentTask(a, nil, nil) != "休息中" {
		t.Fatalf("idle default: %s", JellyCurrentTask(a, nil, nil))
	}
	occ := &store.Occupancy{SourceName: "协作", TaskName: "写报告"}
	got := JellyCurrentTask(a, occ, nil)
	if got != "协作 · 写报告" {
		t.Fatalf("occupancy line: %s", got)
	}
	tasks := []store.AgentTask{{TaskName: "跑集成", Status: "running", Progress: 50}}
	got = JellyCurrentTask(a, nil, tasks)
	if got != "跑集成 · 50%" {
		t.Fatalf("task progress: %s", got)
	}
}

func TestApprovalActionsAndTitle(t *testing.T) {
	acts := ApprovalActions("Bash")
	if len(acts) != 2 || acts[0]["k"] != "allow" {
		t.Fatalf("bash actions: %+v", acts)
	}
	trust := ApprovalActions("WorkspaceTrust")
	if trust[0]["l"] != "信任并继续" {
		t.Fatalf("trust label: %+v", trust)
	}
	p := permission.Public{ToolName: "Bash", Meaning: "危险删除", Summary: "rm"}
	if ApprovalTitle(p) != "危险删除" {
		t.Fatalf("title: %s", ApprovalTitle(p))
	}
}
