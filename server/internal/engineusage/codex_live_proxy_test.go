//go:build liveproxy

package engineusage

import (
	"context"
	"strings"
	"testing"
	"time"
)

// 手动验证：go test ./internal/engineusage/ -tags liveproxy -run TestCodexLiveViaProxy -v
func TestCodexLiveViaProxy(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	u := fetchCodex(ctx)
	t.Logf("ok=%v err=%q windows=%d plan=%q", u.OK, u.Error, len(u.Windows), u.Plan)
	if strings.Contains(u.Error, "connection refused") {
		t.Fatalf("still connection refused after proxy support: %s", u.Error)
	}
}
