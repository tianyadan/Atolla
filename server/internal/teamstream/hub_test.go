package teamstream

import (
	"testing"
	"time"
)

func TestPublishIncrementsSeqAndDelivers(t *testing.T) {
	h := NewHub(8)
	ch := h.Subscribe(1)
	defer h.Unsubscribe(1, ch)

	e1 := h.Publish(1, "agent.status", map[string]any{"agentId": "7", "state": "working"})
	e2 := h.Publish(1, "task.progress", map[string]any{"agentId": "7", "progress": 40})
	if e1.Seq != 1 || e2.Seq != 2 {
		t.Fatalf("seq want 1,2 got %d,%d", e1.Seq, e2.Seq)
	}
	if e1.Payload["type"] != "agent.status" || e1.Payload["seq"].(int64) != 1 {
		t.Fatalf("payload type/seq: %+v", e1.Payload)
	}

	got1 := recv(t, ch)
	got2 := recv(t, ch)
	if got1.Seq != 1 || got2.Seq != 2 {
		t.Fatalf("recv seq %d %d", got1.Seq, got2.Seq)
	}
}

func TestReplayAfterRingAndGap(t *testing.T) {
	h := NewHub(3)
	h.Publish(9, "agent.status", map[string]any{"agentId": "1"}) // seq1
	h.Publish(9, "agent.status", map[string]any{"agentId": "2"}) // seq2
	h.Publish(9, "agent.status", map[string]any{"agentId": "3"}) // seq3
	h.Publish(9, "agent.status", map[string]any{"agentId": "4"}) // seq4，挤掉 seq1 → ring[2,3,4]
	h.Publish(9, "agent.status", map[string]any{"agentId": "5"}) // seq5，挤掉 seq2 → ring[3,4,5]

	// 从 seq2 之后：缺口（seq+1=3 虽在，但中间丢了？ afterSeq=2 → next=3=oldest，可完整补发）
	evs, ok := h.ReplayAfter(9, 2)
	if !ok {
		t.Fatal("expected ok replay from 2")
	}
	if len(evs) != 3 || evs[0].Seq != 3 || evs[2].Seq != 5 {
		t.Fatalf("replay from 2: %+v", seqs(evs))
	}

	// afterSeq=1：期望的下一条是 2，但 oldest=3 → 缺口
	_, ok = h.ReplayAfter(9, 1)
	if ok {
		t.Fatal("expected gap when afterSeq older than ring")
	}

	// 无历史断点：ok 且空（调用方发 snapshot）
	evs, ok = h.ReplayAfter(9, 0)
	if !ok || len(evs) != 0 {
		t.Fatalf("afterSeq=0 want empty ok, got ok=%v n=%d", ok, len(evs))
	}

	// 已追上最新
	evs, ok = h.ReplayAfter(9, 5)
	if !ok || len(evs) != 0 {
		t.Fatalf("caught up want empty, got %v %+v", ok, seqs(evs))
	}
}

func TestReplayAfterEmptyTeamWithLastID(t *testing.T) {
	h := NewHub(4)
	_, ok := h.ReplayAfter(42, 7)
	if ok {
		t.Fatal("empty team with Last-Event-ID should report gap")
	}
}

func TestTeamsIsolated(t *testing.T) {
	h := NewHub(8)
	h.Publish(1, "agent.status", map[string]any{"agentId": "a"})
	h.Publish(2, "agent.status", map[string]any{"agentId": "b"})
	if h.CurrentSeq(1) != 1 || h.CurrentSeq(2) != 1 {
		t.Fatalf("per-team seq broken: %d %d", h.CurrentSeq(1), h.CurrentSeq(2))
	}
	ch := h.Subscribe(2)
	defer h.Unsubscribe(2, ch)
	h.Publish(1, "task.done", map[string]any{"taskId": "x"})
	select {
	case ev := <-ch:
		t.Fatalf("team2 should not get team1 event: %+v", ev)
	case <-time.After(30 * time.Millisecond):
	}
}

func recv(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	case <-time.After(time.Second):
		t.Fatal("timeout waiting event")
		return Event{}
	}
}

func seqs(evs []Event) []int64 {
	out := make([]int64, len(evs))
	for i, e := range evs {
		out[i] = e.Seq
	}
	return out
}
