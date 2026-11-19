package store

import (
	"context"
	"testing"
	"time"
)

func TestLatestAgentAskRuntimeDetail(t *testing.T) {
	st := openTestStore(t)
	agentID := createTestAgent(t, st, "runtime-latest")
	ctx := context.Background()

	firstID, err := st.BeginAgentAskLog(ctx, agentID, 11, 101, AgentAskSourceAdmin, "codex")
	if err != nil {
		t.Fatalf("begin first runtime: %v", err)
	}
	if err := st.FinishAgentAskLog(ctx, firstID, 10, 5, 15, 1000, AgentAskStatusCompleted, "", ""); err != nil {
		t.Fatalf("finish first runtime: %v", err)
	}

	latestID, err := st.BeginAgentAskLog(ctx, agentID, 12, 102, AgentAskSourceAdmin, "codex")
	if err != nil {
		t.Fatalf("begin latest runtime: %v", err)
	}
	if err := st.InsertAgentAskToolCall(ctx, latestID, agentID, "agent", AgentAskToolOK, 0); err != nil {
		t.Fatalf("insert tool call: %v", err)
	}
	if _, err := st.InsertCommandAudit(ctx, &CommandAudit{
		AgentID: agentID, ToolName: "Bash", CommandText: "npm run build", Decision: "allow",
	}); err != nil {
		t.Fatalf("insert command audit: %v", err)
	}
	if err := st.FinishAgentAskLog(ctx, latestID, 120, 30, 150, 2500, AgentAskStatusCompleted, "", ""); err != nil {
		t.Fatalf("finish latest runtime: %v", err)
	}
	traceID, err := st.BeginAgentLLMInvocation(ctx, AgentLLMInvocation{
		AskLogID: latestID, AgentID: agentID, StepNo: 1, Engine: "codex",
		Source: "Codex JSONL", Model: "引擎未提供", InputContent: `{"messages":[]}`,
		AvailabilityNote: "CLI 内部调用边界不可获取",
	})
	if err != nil {
		t.Fatalf("begin llm trace: %v", err)
	}
	if err := st.UpdateAgentLLMInvocationUsage(ctx, traceID, 120, 30, 10, 200000, 130); err != nil {
		t.Fatalf("update llm trace: %v", err)
	}
	if err := st.FinishAgentLLMInvocation(ctx, traceID, "success", `{"text":"ok"}`, 2400); err != nil {
		t.Fatalf("finish llm trace: %v", err)
	}

	detail, err := st.LatestAgentAskRuntimeDetail(ctx, agentID)
	if err != nil {
		t.Fatalf("load latest runtime: %v", err)
	}
	if detail == nil || detail.ID != latestID || detail.DurationMs != 2500 || detail.TotalTokens != 150 {
		t.Fatalf("unexpected runtime detail: %#v", detail)
	}
	if len(detail.Tools) != 1 || detail.Tools[0].ToolName != "Bash" || detail.Tools[0].Summary != "npm run build" {
		t.Fatalf("unexpected tools: %#v", detail.Tools)
	}
	if len(detail.LLMInvocations) != 1 || detail.LLMInvocations[0].Source != "Codex JSONL" || detail.LLMInvocations[0].InputTokens != 120 {
		t.Fatalf("unexpected llm traces: %#v", detail.LLMInvocations)
	}

}

func TestAgentLLMTraceRetentionAndContentLimit(t *testing.T) {
	if agentLLMTraceRetention != 7*24*time.Hour {
		t.Fatalf("retention=%s want 168h", agentLLMTraceRetention)
	}
	value, truncated := limitLLMTraceContent(string(make([]rune, 128*1024+1)))
	if !truncated || len([]rune(value)) != 128*1024 {
		t.Fatalf("trace content limit not applied")
	}
}

func TestLatestAgentAskRuntimeDetailReturnsNilBeforeFirstRun(t *testing.T) {
	st := openTestStore(t)
	agentID := createTestAgent(t, st, "runtime-empty")
	detail, err := st.LatestAgentAskRuntimeDetail(context.Background(), agentID)
	if err != nil {
		t.Fatalf("load empty runtime: %v", err)
	}
	if detail != nil {
		t.Fatalf("detail = %#v, want nil", detail)
	}
}
