package notify

import (
	"testing"
	"time"
)

func TestTaskTitleWithinTen(t *testing.T) {
	if got := TaskTitle("请帮我看登录超时。然后把重试改成三次"); got != "看登录超时" {
		t.Fatalf("got %q", got)
	}
	long := stringsRepeat("修", 20)
	got := TaskTitle(long)
	if n := len([]rune(got)); n != 10 {
		t.Fatalf("len=%d %q", n, got)
	}
	if TaskDoneText("   ") != "任务未命名任务 任务已完成" {
		t.Fatal(TaskDoneText("   "))
	}
}

func TestPushCardPassesTitleBodyIcon(t *testing.T) {
	n := New("echo", true)
	var got []string
	done := make(chan struct{})
	n.runner = func(name string, args ...string) error {
		got = append([]string{name}, args...)
		close(done)
		return nil
	}
	if !n.PushCard("perm-1", "小周", PermissionPendingText, "https://cdn.example/a.jpg") {
		t.Fatal("want send")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runner not called")
	}
	if n.PushCard("perm-1", "小周", PermissionPendingText, "https://cdn.example/a.jpg") {
		t.Fatal("dedupe")
	}
	if len(got) != 4 || got[1] != "小周" || got[2] != PermissionPendingText || got[3] != "https://cdn.example/a.jpg" {
		t.Fatalf("args=%v", got)
	}
}

func stringsRepeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}

func stringsHasPrefix(s, p string) bool { return len(s) >= len(p) && s[:len(p)] == p }
func stringsHasSuffix(s, p string) bool { return len(s) >= len(p) && s[len(s)-len(p):] == p }
func stringsContains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
