package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseCodexJSONLCommandAndMessage(t *testing.T) {
	lines := []string{
		`{"type":"thread.started","thread_id":"tid-1"}`,
		`{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","status":"in_progress"}}`,
		`{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/tmp\n","exit_code":0,"status":"completed"}}`,
		`{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"done"}}`,
		`{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":10,"output_tokens":5}}`,
	}
	var acts []Activity
	var chunks []string
	var metas []RunMeta
	for _, line := range lines {
		ev, ok := ParseCodexJSONLLine([]byte(line))
		if !ok {
			t.Fatalf("parse fail: %s", line)
		}
		if ev.Activity != nil {
			acts = append(acts, *ev.Activity)
		}
		if ev.Chunk != "" {
			chunks = append(chunks, ev.Chunk)
		}
		if ev.Meta != nil {
			metas = append(metas, *ev.Meta)
		}
	}
	if len(acts) < 2 || !strings.Contains(acts[0].Summary, "pwd") {
		t.Fatalf("acts=%v", acts)
	}
	// Chunk 原文仍是 done；时间线前缀在 runCodexJSONStream 层添加
	if strings.Join(chunks, "") != "done" {
		t.Fatalf("chunks=%v", chunks)
	}
	if len(metas) == 0 || metas[len(metas)-1].SessionID != "tid-1" && metas[0].SessionID != "tid-1" {
		// session may arrive on first meta; usage on last
		foundSid := false
		for _, m := range metas {
			if m.SessionID == "tid-1" {
				foundSid = true
			}
		}
		if !foundSid {
			t.Fatalf("metas=%v", metas)
		}
	}
	var usage RunMeta
	for _, m := range metas {
		if m.InputTokens > 0 {
			usage = m
		}
	}
	if usage.InputTokens != 100 || usage.OutputTokens != 5 {
		t.Fatalf("usage=%+v", usage)
	}
}

func TestParseCodexJSONLInvalid(t *testing.T) {
	_, ok := ParseCodexJSONLLine([]byte("not-json"))
	if ok {
		t.Fatal("expected false")
	}
	_ = json.RawMessage{}
}

func TestParseCodexJSONLReasoningChunk(t *testing.T) {
	line := `{"type":"item.completed","item":{"id":"r1","type":"reasoning","text":"先确认工作区再执行命令"}}`
	ev, ok := ParseCodexJSONLLine([]byte(line))
	if !ok || ev.Chunk != "先确认工作区再执行命令" || !ev.Reasoning {
		t.Fatalf("ev=%+v ok=%v", ev, ok)
	}
}

func TestCodexStreamKeepsOnlyLastAgentMessage(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-codex")
	script := "#!/bin/sh\ncat <<'EOF'\n" +
		`{"type":"item.completed","item":{"id":"1","type":"agent_message","text":"先看目录"}}` + "\n" +
		`{"type":"item.started","item":{"id":"2","type":"command_execution","command":"pwd","status":"in_progress"}}` + "\n" +
		`{"type":"item.completed","item":{"id":"2","type":"command_execution","command":"pwd","aggregated_output":"/tmp\n","exit_code":0,"status":"completed"}}` + "\n" +
		`{"type":"item.completed","item":{"id":"3","type":"agent_message","text":"最终结论"}}` + "\n" +
		`{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}` + "\n" +
		"EOF\n"
	if err := os.WriteFile(bin, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	var reasoned []string
	var body []string
	phaseThinking := false
	text, _, err := CodexAskMetaExPhase(
		context.Background(), bin, dir, "", "q", "",
		func(chunk string) {
			if phaseThinking {
				reasoned = append(reasoned, chunk)
			} else {
				body = append(body, chunk)
			}
		},
		time.Second*5, nil, nil,
		func(p PhaseEvent) {
			phaseThinking = p.Phase == PhaseThinking
		},
		"", nil, nil, "workspace-write", "",
	)
	if err != nil {
		t.Fatal(err)
	}
	if text != "最终结论" {
		t.Fatalf("final=%q", text)
	}
	if strings.Join(body, "") != "最终结论" {
		t.Fatalf("body=%v", body)
	}
	joined := strings.Join(reasoned, "")
	if !strings.Contains(joined, "先看目录") {
		t.Fatalf("reasoned=%v", reasoned)
	}
}

func TestCodexSandboxMode(t *testing.T) {
	if CodexSandboxMode(true) != "workspace-write" {
		t.Fatal("bound should workspace-write")
	}
	if CodexSandboxMode(false) != "danger-full-access" {
		t.Fatal("unbound should danger-full-access")
	}
}

func TestCodexArgsSandbox(t *testing.T) {
	bound := CodexArgs("/tmp/ws", "hi", true, CodexSandboxMode(true), "")
	joined := strings.Join(bound, " ")
	if !strings.Contains(joined, "-s workspace-write") || !strings.Contains(joined, "-C /tmp/ws") {
		t.Fatalf("bound args=%v", bound)
	}
	free := CodexArgs("/tmp/ws", "hi", false, CodexSandboxMode(false), "gpt-6.2-sol")
	joined = strings.Join(free, " ")
	if !strings.Contains(joined, "-s danger-full-access") || !strings.Contains(joined, "-m gpt-6.2-sol") {
		t.Fatalf("unbound args=%v", free)
	}
	resume := codexResumeArgs("/tmp/ws", "hi", "workspace-write", "gpt-6.2-astra", "thr-1", true)
	rj := strings.Join(resume, " ")
	if !strings.Contains(rj, "-m gpt-6.2-astra") || !strings.Contains(rj, "resume thr-1") {
		t.Fatalf("resume args=%v", resume)
	}
}
