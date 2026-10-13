package remotebridge

import (
	"testing"
)

func TestGenerateInstancePassword(t *testing.T) {
	seen := map[string]struct{}{}
	for i := 0; i < 32; i++ {
		p := GenerateInstancePassword()
		if p == "" {
			t.Fatal("password must not be empty")
		}
		if len(p) != 6 {
			t.Fatalf("password length want 6 got %d: %q", len(p), p)
		}
		if !ValidInstancePassword(p) {
			t.Fatalf("password outside charset: %q", p)
		}
		seen[p] = struct{}{}
	}
}
