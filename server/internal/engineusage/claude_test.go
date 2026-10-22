package engineusage

import (
	"testing"
)

func TestEngineUsageMapClaude(t *testing.T) {
	raw := []byte(`{
		"subscription_type": "pro",
		"five_hour": {
			"utilization": 0.35,
			"resets_at": "2026-10-21T06:30:00Z"
		},
		"seven_day": {
			"used_percent": 12,
			"resets_at": "2026-10-28T06:30:00Z"
		}
	}`)
	m, err := MapClaudeResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if m.Plan != "pro" {
		t.Fatalf("plan=%q", m.Plan)
	}
	if len(m.Windows) != 2 {
		t.Fatalf("windows=%d", len(m.Windows))
	}
	if m.Windows[0].UsedPercent != 35 {
		t.Fatalf("session pct=%d", m.Windows[0].UsedPercent)
	}
	if m.Windows[1].UsedPercent != 12 {
		t.Fatalf("weekly pct=%d", m.Windows[1].UsedPercent)
	}
}

func TestEngineUsageWorkosSessionCookie(t *testing.T) {
	// JWT payload: {"sub":"auth0|user_01TEST"}
	token := "aaa.eyJzdWIiOiJhdXRoMHx1c2VyXzAxVEVTVCJ9.bbb"
	cookie, ok := workosSessionCookie(token)
	if !ok {
		t.Fatal("expected ok")
	}
	if cookie != "WorkosCursorSessionToken=user_01TEST%3A%3A"+token {
		t.Fatalf("cookie=%q", cookie)
	}
}
