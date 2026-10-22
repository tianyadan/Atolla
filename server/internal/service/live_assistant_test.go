package service

import (
	"sync"
	"testing"
)

func TestLiveAssistantEndReturnsTail(t *testing.T) {
	svc := &Service{liveAssist: &sync.Map{}}
	buf := svc.beginLiveAssistant(42, 7)
	if buf == nil {
		t.Fatal("expected buffer")
	}
	buf.appendChunk("思考A")
	buf.mu.Lock()
	buf.flushed = true
	buf.buf.Reset()
	buf.buf.WriteString("收尾B")
	buf.mu.Unlock()

	tail, had := svc.endLiveAssistant(42)
	if !had || tail != "收尾B" {
		t.Fatalf("tail=%q had=%v", tail, had)
	}
	if _, had2 := svc.endLiveAssistant(42); had2 {
		t.Fatal("second end should be empty")
	}
}
