package store

import "testing"

func TestValidEngine(t *testing.T) {
	for _, e := range []string{"claude", "codex", "agent", "Claude", " CODEX "} {
		if !ValidEngine(e) {
			t.Fatalf("ValidEngine(%q)=false", e)
		}
	}
	if ValidEngine("cursor") {
		t.Fatal("cursor should be invalid in v0.1.3")
	}
}

func TestDefaultBin(t *testing.T) {
	if DefaultBin("claude") != "claude" || DefaultBin("codex") != "codex" || DefaultBin("agent") != "agent" {
		t.Fatal("unexpected default bins")
	}
}

func TestResolveEngineBinRepairsNulCorruption(t *testing.T) {
	got := ResolveEngineBin("agent", "\x00gent")
	if got != "agent" {
		t.Fatalf("nul bin -> %q want agent", got)
	}
	got = ResolveEngineBin("\x00gent", "")
	if got != "agent" {
		t.Fatalf("nul engine -> %q want agent", got)
	}
	got = ResolveEngineBin("claude", "gent")
	if got != "claude" {
		t.Fatalf("mismatched bare name -> %q want claude", got)
	}
	got = ResolveEngineBin("agent", "/opt/bin/agent")
	if got != "/opt/bin/agent" {
		t.Fatalf("custom path lost: %q", got)
	}
}

func TestValidContextWindow(t *testing.T) {
	for _, n := range []int64{262144, 524288, 1000000} {
		if !ValidContextWindow(n) { t.Fatalf("expected supported window %d", n) }
	}
	for _, n := range []int64{0, 200000, 123456, -1} {
		if ValidContextWindow(n) { t.Fatalf("unexpected supported window %d", n) }
	}
}
