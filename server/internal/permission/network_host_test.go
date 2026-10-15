package permission

import "testing"

func TestHostMatchesAllowlist(t *testing.T) {
	patterns := []string{"restapi.amap.com", "*.amap.com", "example.com"}
	if !HostMatchesAllowlist("restapi.amap.com", patterns) {
		t.Fatal("exact")
	}
	if !HostMatchesAllowlist("webapi.amap.com", patterns) {
		t.Fatal("wildcard")
	}
	if !HostMatchesAllowlist("amap.com", patterns) {
		t.Fatal("wildcard apex")
	}
	if HostMatchesAllowlist("evil.com", patterns) {
		t.Fatal("should miss")
	}
}

func TestExtractNetworkHost(t *testing.T) {
	a := FromClaude("claude", 1, 2, "WebFetch", map[string]any{"url": "https://RestAPI.amap.com/v3/x"}, "/tmp")
	if got := ExtractNetworkHost(a); got != "restapi.amap.com" {
		t.Fatalf("got %q", got)
	}
	b := FromClaude("claude", 1, 2, "Bash", map[string]any{"command": `curl -s 'https://api.example.com/path'`}, "/tmp")
	if got := ExtractNetworkHost(b); got != "api.example.com" {
		t.Fatalf("bash got %q", got)
	}
}

func TestNormalizeAllowlistPatternRejectsPrivate(t *testing.T) {
	if _, err := NormalizeAllowlistPattern("127.0.0.1"); err == nil {
		t.Fatal("expected reject loopback")
	}
	if _, err := NormalizeAllowlistPattern("169.254.169.254"); err == nil {
		t.Fatal("expected reject metadata")
	}
	got, err := NormalizeAllowlistPattern("HTTPS://Foo.COM/bar")
	if err != nil || got != "foo.com" {
		t.Fatalf("got %q err=%v", got, err)
	}
}

func TestGatewayAllowNetworkSkipsDomainConfirm(t *testing.T) {
	g := NewGateway(nil, nil)
	a := FromClaude("claude", 1, 9, "WebFetch", map[string]any{"url": "https://new.example.com/x"}, "/tmp")
	pd := g.Evaluate(nil, a, EvaluateOpts{
		Policy:          &AgentPolicy{AllowNetwork: true},
		NetworkPatterns: []string{"*.amap.com"},
	})
	if pd.Decision != DecisionAllow || pd.RuleID != "agent_policy_network" {
		t.Fatalf("want allow when AllowNetwork, got %+v", pd)
	}
	pd2 := g.Evaluate(nil, a, EvaluateOpts{
		Policy:          &AgentPolicy{AllowNetwork: true},
		NetworkPatterns: []string{"new.example.com"},
	})
	if pd2.Decision != DecisionAllow || pd2.RuleID != "network_allowlist" {
		t.Fatalf("want allow listed, got %+v", pd2)
	}
}
