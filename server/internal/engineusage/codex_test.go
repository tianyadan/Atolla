package engineusage

import (
	"strings"
	"testing"
)

func TestEngineUsageMapCodex(t *testing.T) {
	raw := []byte(`{
		"plan_type": "pro",
		"rate_limit": {
			"primary_window": {
				"used_percent": 35,
				"reset_at": 1735401600,
				"limit_window_seconds": 18000
			},
			"secondary_window": {
				"used_percent": 5,
				"reset_at": 1735920000,
				"limit_window_seconds": 604800
			}
		}
	}`)
	m, err := MapCodexResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if m.Plan != "pro" {
		t.Fatalf("plan=%q", m.Plan)
	}
	if len(m.Windows) != 2 {
		t.Fatalf("windows=%d", len(m.Windows))
	}
	if m.Windows[0].Kind != "session" || m.Windows[0].UsedPercent != 35 || m.Windows[0].WindowMinutes != 300 {
		t.Fatalf("primary=%+v", m.Windows[0])
	}
	if m.Windows[1].Kind != "weekly" || m.Windows[1].UsedPercent != 5 {
		t.Fatalf("secondary=%+v", m.Windows[1])
	}
	if m.Windows[0].ResetsAt == "" || m.Windows[0].ResetHint == "" {
		t.Fatalf("reset missing: %+v", m.Windows[0])
	}
	if m.Windows[1].ResetsAt == "" || !strings.Contains(m.Windows[1].ResetHint, "2025-01-04") {
		t.Fatalf("weekly reset should include full date: %+v", m.Windows[1])
	}
}
