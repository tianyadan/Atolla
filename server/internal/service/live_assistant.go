package service

import (
	"context"
	"log"
	"strings"
	"sync"

	"atolla/server/internal/store"
)

// liveAssistantBuf 缓冲本轮 Ask 已推送但尚未落库的助手正文。
// 命令消息会立刻 InsertMessage，若此处不先落库，移动端会先看到命令、思考全挤在最后一条。
type liveAssistantBuf struct {
	mu       sync.Mutex
	buf      strings.Builder
	flushed  bool
	agentID  int64
	convID   int64
}

func (s *Service) liveAssistMap() *sync.Map {
	if s.liveAssist == nil {
		s.liveAssist = &sync.Map{}
	}
	return s.liveAssist
}

/** 注册本轮对话的流式助手缓冲 */
func (s *Service) beginLiveAssistant(convID, agentID int64) *liveAssistantBuf {
	if convID <= 0 {
		return nil
	}
	b := &liveAssistantBuf{agentID: agentID, convID: convID}
	s.liveAssistMap().Store(convID, b)
	return b
}

/** 结束本轮，取出未落库尾巴并注销 */
func (s *Service) endLiveAssistant(convID int64) (tail string, hadFlush bool) {
	if convID <= 0 || s.liveAssist == nil {
		return "", false
	}
	v, ok := s.liveAssist.LoadAndDelete(convID)
	if !ok || v == nil {
		return "", false
	}
	b := v.(*liveAssistantBuf)
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String(), b.flushed
}

/** 若 finishManagedAsk 未接管，则丢弃缓冲避免泄漏 */
func (s *Service) abandonLiveAssistant(convID int64) {
	if convID <= 0 || s.liveAssist == nil {
		return
	}
	s.liveAssist.Delete(convID)
}

/** 追加流式 chunk（SSE 已另行推送） */
func (b *liveAssistantBuf) appendChunk(chunk string) {
	if b == nil || chunk == "" {
		return
	}
	b.mu.Lock()
	b.buf.WriteString(chunk)
	b.mu.Unlock()
}

/** 命令落库前：把已缓冲思考/正文写成一条 assistant，保证时间线顺序 */
func (s *Service) flushLiveAssistantBeforeCommand(ctx context.Context, convID int64) {
	if convID <= 0 || s.liveAssist == nil {
		return
	}
	v, ok := s.liveAssist.Load(convID)
	if !ok || v == nil {
		return
	}
	b := v.(*liveAssistantBuf)
	b.mu.Lock()
	text := b.buf.String()
	b.buf.Reset()
	if strings.TrimSpace(text) != "" {
		b.flushed = true
	}
	agentID := b.agentID
	b.mu.Unlock()

	if strings.TrimSpace(text) == "" {
		return
	}
	if _, err := s.Store.InsertMessage(ctx, &store.Message{
		ConversationID: convID,
		Role:           "assistant",
		Content:        text,
		Status:         "ok",
	}); err != nil {
		log.Printf("flushLiveAssistant: insert failed conv=%d: %v", convID, err)
		return
	}
	if s.RemoteBridge != nil && agentID > 0 {
		s.RemoteBridge.PushAgentMessagesSnapshot(agentID)
	}
}
