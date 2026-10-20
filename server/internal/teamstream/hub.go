// Package teamstream 提供工作组（agent_folders）实时事件的进程内 pub/sub。
// 供水母 UI GET /api/teams/:teamId/stream 使用：环形缓冲 + 递增 seq + Last-Event-ID 补发。
package teamstream

import (
	"sync"
)

const defaultRingSize = 512

// Event 一条带序号的团队事件；Payload 已含 type，Hub 再写入 seq。
type Event struct {
	Seq     int64
	TeamID  int64
	Payload map[string]any
}

// Hub 按工作组隔离的事件总线（进程内，重启清空）。
type Hub struct {
	mu      sync.Mutex
	ringCap int
	teams   map[int64]*teamBuf
}

type teamBuf struct {
	seq  int64
	ring []Event // 环形，按写入顺序保存最近 ringCap 条
	subs map[chan Event]struct{}
}

// NewHub 创建事件中枢；ringCap<=0 时用默认 512。
func NewHub(ringCap int) *Hub {
	if ringCap <= 0 {
		ringCap = defaultRingSize
	}
	return &Hub{ringCap: ringCap, teams: map[int64]*teamBuf{}}
}

func (h *Hub) buf(teamID int64) *teamBuf {
	b, ok := h.teams[teamID]
	if !ok {
		b = &teamBuf{subs: map[chan Event]struct{}{}}
		h.teams[teamID] = b
	}
	return b
}

// Publish 向指定工作组广播一条事件，返回写入后的 Event（含 seq）。
// fields 会被浅拷贝并写入 type/seq；调用方勿再修改返回的 Payload。
func (h *Hub) Publish(teamID int64, typ string, fields map[string]any) Event {
	h.mu.Lock()
	defer h.mu.Unlock()
	b := h.buf(teamID)
	b.seq++
	payload := make(map[string]any, len(fields)+2)
	for k, v := range fields {
		payload[k] = v
	}
	payload["type"] = typ
	payload["seq"] = b.seq
	ev := Event{Seq: b.seq, TeamID: teamID, Payload: payload}
	b.ring = append(b.ring, ev)
	if len(b.ring) > h.ringCap {
		b.ring = b.ring[len(b.ring)-h.ringCap:]
	}
	for ch := range b.subs {
		select {
		case ch <- ev:
		default:
			// 慢消费者丢事件，避免阻塞发布路径
		}
	}
	return ev
}

// Subscribe 订阅某工作组实时事件；返回缓冲通道，用完须 Unsubscribe。
func (h *Hub) Subscribe(teamID int64) chan Event {
	ch := make(chan Event, 64)
	h.mu.Lock()
	defer h.mu.Unlock()
	b := h.buf(teamID)
	b.subs[ch] = struct{}{}
	return ch
}

// Unsubscribe 退订并关闭通道。
func (h *Hub) Unsubscribe(teamID int64, ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	b, ok := h.teams[teamID]
	if !ok {
		return
	}
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
}

// ReplayAfter 返回 seq > afterSeq 的缓冲事件。
// ok=false 表示存在缺口（afterSeq 已被环形缓冲挤出），调用方应改推 snapshot。
// afterSeq<=0 时返回 ok=true 且空切片（表示无历史可补，应由调用方发 snapshot）。
func (h *Hub) ReplayAfter(teamID int64, afterSeq int64) (events []Event, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	b, exists := h.teams[teamID]
	if !exists || len(b.ring) == 0 {
		if afterSeq <= 0 {
			return nil, true
		}
		// 有 Last-Event-ID 但本地无缓冲 → 视为缺口
		return nil, false
	}
	if afterSeq <= 0 {
		return nil, true
	}
	oldest := b.ring[0].Seq
	if afterSeq < oldest-1 {
		// 请求的断点早于缓冲窗口
		return nil, false
	}
	if afterSeq >= b.seq {
		return nil, true
	}
	out := make([]Event, 0, len(b.ring))
	for _, ev := range b.ring {
		if ev.Seq > afterSeq {
			out = append(out, ev)
		}
	}
	return out, true
}

// CurrentSeq 返回工作组当前最大 seq（无事件则为 0）。
func (h *Hub) CurrentSeq(teamID int64) int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	b, ok := h.teams[teamID]
	if !ok {
		return 0
	}
	return b.seq
}

// SubscriberCount 测试用：某工作组订阅者数量。
func (h *Hub) SubscriberCount(teamID int64) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	b, ok := h.teams[teamID]
	if !ok {
		return 0
	}
	return len(b.subs)
}
