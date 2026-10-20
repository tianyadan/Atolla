package store

import (
	"strings"
	"testing"
	"time"
)

func TestAgentAskAuditFilterNormalize(t *testing.T) {
	f := AgentAskAuditFilter{}.normalize()
	if f.From.IsZero() || f.To.IsZero() {
		t.Fatal("expected default range")
	}
	if f.To.Sub(f.From) < 6*24*time.Hour {
		t.Fatalf("default window too small: %v", f.To.Sub(f.From))
	}
}

func TestAgentAskRangeArgsIncludesProcessingExclusion(t *testing.T) {
	where, args := agentAskRangeArgs(AgentAskAuditFilter{AgentID: 7})
	if where == "" || len(args) < 4 {
		t.Fatalf("where=%q args=%v", where, args)
	}
	found := false
	for _, a := range args {
		if a == AgentAskStatusProcessing {
			found = true
		}
	}
	if !found {
		t.Fatal("expected processing status excluded in args")
	}
	if args[len(args)-1] != int64(7) {
		t.Fatalf("agent filter last arg = %v", args[len(args)-1])
	}
}

func TestAgentAskRangeArgsJoinAlias(t *testing.T) {
	where, _ := agentAskRangeArgs(AgentAskAuditFilter{}, "l")
	if !strings.Contains(where, "l.status") || !strings.Contains(where, "l.started_at") {
		t.Fatalf("expected aliased columns, got %q", where)
	}
}
