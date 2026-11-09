package agent

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWarmRuntimeReusesProcessForSameConversation(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-claude")
	script := "#!/bin/sh\nwhile IFS= read -r line; do\n  printf '%s\\n' '{\"type\":\"result\",\"result\":\"ok\"}'\ndone\n"
	if err := os.WriteFile(bin, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	r := NewWarmRuntime(bin, time.Minute, 2048)
	defer r.Close()
	hook := HookSpec{ConvID: 7}
	for i := 0; i < 2; i++ {
		out, _, err := r.Ask(context.Background(), dir, "", "hello", "", nil, time.Second, hook, nil, nil, nil, "", nil)
		if err != nil || out != "ok" {
			t.Fatalf("ask %d output=%q err=%v", i+1, out, err)
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.workers) != 1 || r.workers[7] == nil {
		t.Fatalf("worker was not reused: %+v", r.workers)
	}
}

func TestWarmRuntimeReapsExpiredIdleOnly(t *testing.T) {
	now := time.Now()
	stopped := map[int64]bool{}
	r := &WarmRuntime{
		ttl: 60 * time.Second,
		workers: map[int64]*warmWorker{
			1: {convID: 1, lastUsed: now.Add(-61 * time.Second)},
			2: {convID: 2, lastUsed: now.Add(-2 * time.Minute), users: 1},
			3: {convID: 3, lastUsed: now.Add(-10 * time.Second)},
		},
		rss: func(int) int64 { return 0 },
		stopOne: func(w *warmWorker) {
			stopped[w.convID] = true
		},
	}
	r.reap()
	if !stopped[1] || stopped[2] || stopped[3] {
		t.Fatalf("unexpected stopped set: %+v", stopped)
	}
	if r.workers[2] == nil || r.workers[3] == nil {
		t.Fatalf("active or fresh worker was removed: %+v", r.workers)
	}
}

func TestWarmRuntimeMemoryPressureReapsAllIdle(t *testing.T) {
	stopped := map[int64]bool{}
	r := &WarmRuntime{
		ttl:           time.Hour,
		memoryLimitKB: 2 * 1024 * 1024,
		workers: map[int64]*warmWorker{
			1: {convID: 1, pgid: 11, lastUsed: time.Now()},
			2: {convID: 2, pgid: 12, lastUsed: time.Now()},
			3: {convID: 3, pgid: 13, lastUsed: time.Now(), users: 1},
		},
		rss: func(pgid int) int64 {
			if pgid == 11 || pgid == 12 {
				return 1024 * 1024
			}
			return 4 * 1024 * 1024
		},
		stopOne: func(w *warmWorker) {
			stopped[w.convID] = true
		},
	}
	r.reap()
	if !stopped[1] || !stopped[2] || stopped[3] {
		t.Fatalf("unexpected stopped set: %+v", stopped)
	}
	if len(r.workers) != 1 || r.workers[3] == nil {
		t.Fatalf("running worker should survive pressure: %+v", r.workers)
	}
}
