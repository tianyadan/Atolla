package notify

import (
	"strings"
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

func TestTaskDoneCard(t *testing.T) {
	card := TaskDoneCard("全栈-小X", "研发部", "帮我修复远程中继密码轮换", 503000)
	if card.Title != "✅ Atolla · 任务完成" {
		t.Fatalf("title=%q", card.Title)
	}
	for _, want := range []string{"全栈-小X｜研发部", "修复远程中继密码轮换", "用时 8分23秒"} {
		if !strings.Contains(card.Body, want) {
			t.Fatalf("body=%q, missing %q", card.Body, want)
		}
	}
	if card.Group != AtollaGroup || card.Sound != "bell" || card.Level != "active" {
		t.Fatalf("card=%+v", card)
	}
}

func TestPermissionCard(t *testing.T) {
	summary := "npm run build\n" + stringsRepeat("x", 80)
	card := PermissionCard("全栈-小X", "研发部", summary, "high")
	if card.Title != "⚠️ Atolla · 命令待审批" {
		t.Fatalf("title=%q", card.Title)
	}
	for _, want := range []string{"全栈-小X｜研发部", "待审批：npm run build", "风险：高风险"} {
		if !strings.Contains(card.Body, want) {
			t.Fatalf("body=%q, missing %q", card.Body, want)
		}
	}
	if strings.Contains(card.Body, "\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") {
		t.Fatalf("command should be one line: %q", card.Body)
	}
	if !strings.Contains(card.Body, "…") || card.Group != AtollaGroup || card.Sound != "alarm" || card.Level != "timeSensitive" {
		t.Fatalf("card=%+v", card)
	}
}

func TestPushPassesCompleteCard(t *testing.T) {
	n := New("echo", true)
	var got []string
	done := make(chan struct{})
	n.runner = func(name string, args ...string) error {
		got = append([]string{name}, args...)
		close(done)
		return nil
	}
	card := Card{
		DedupeKey: "perm-1",
		Title:     "⚠️ Atolla · 命令待审批",
		Body:      "小周｜研发部\n待审批：npm run build",
		Icon:      "https://cdn.example/app.png",
		Group:     "Atolla",
		URL:       "atolla://approval/mac/1/perm-1",
		Sound:     "alarm",
		Level:     "timeSensitive",
	}
	if !n.Push(card) {
		t.Fatal("want send")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runner not called")
	}
	if n.Push(card) {
		t.Fatal("dedupe")
	}
	if len(got) != 8 || got[1] != card.Title || got[2] != card.Body || got[3] != card.Icon ||
		got[4] != card.Group || got[5] != card.URL || got[6] != card.Sound || got[7] != card.Level {
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
