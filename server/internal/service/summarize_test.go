package service

import "testing"

func TestSummarizeShellShowsFullCommand(t *testing.T) {
	in := map[string]interface{}{"command": "ls -la /tmp/project && git status"}
	got := summarize("Shell", in)
	if got != "ls -la /tmp/project && git status" {
		t.Fatalf("Shell summary = %q", got)
	}
	got = summarize("bash", map[string]interface{}{"cmd": "pwd"})
	if got != "pwd" {
		t.Fatalf("bash cmd fallback = %q", got)
	}
	if summarize("Shell", map[string]interface{}{}) != "" {
		t.Fatal("empty shell command should not fall back to tool name")
	}
}

func TestSummarizeBashUnchanged(t *testing.T) {
	got := summarize("Bash", map[string]interface{}{"command": "git status"})
	if got != "git status" {
		t.Fatalf("Bash summary = %q", got)
	}
}
