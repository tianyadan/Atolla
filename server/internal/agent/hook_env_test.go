package agent

import (
	"strings"
	"testing"
)

func TestConvRoutingEnv(t *testing.T) {
	if got := ConvRoutingEnv(0, "http://x", 1); got != nil {
		t.Fatalf("conv=0 want nil, got %v", got)
	}
	got := ConvRoutingEnv(42, "http://backend", 7)
	joined := strings.Join(got, "\n")
	if !strings.Contains(joined, "AVATAR_CONV_ID=42") {
		t.Fatalf("missing conv: %v", got)
	}
	if !strings.Contains(joined, "AVATAR_BACKEND_URL=http://backend") {
		t.Fatalf("missing backend: %v", got)
	}
	if !strings.Contains(joined, "AVATAR_POLICY_AGENT_ID=7") {
		t.Fatalf("missing policy: %v", got)
	}
}

func TestHookWrapperScriptPrefersParentEnv(t *testing.T) {
	script := hookWrapperScript("/bin/avatar-hook", "http://b", 99)
	if !strings.Contains(script, `if [ -z "$AVATAR_CONV_ID" ]`) {
		t.Fatalf("script must not overwrite parent AVATAR_CONV_ID:\n%s", script)
	}
	if !strings.Contains(script, "export AVATAR_CONV_ID=99") {
		t.Fatalf("script must fall back to baked conv id:\n%s", script)
	}
	if strings.Contains(script, "export AVATAR_CONV_ID=99\nexport AVATAR_BACKEND") {
		t.Fatalf("must not unconditionally export conv id before empty check:\n%s", script)
	}
}
