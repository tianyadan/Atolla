package remotebridge

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// mobileViewerTTL: no heartbeat within this window → PC treats as left.
const mobileViewerTTL = 60 * time.Second

// applyRelayMobileViewer syncs presence from relay heartbeat (empty clears).
func (b *Bridge) applyRelayMobileViewer(agentIDRaw string) {
	if b == nil {
		return
	}
	raw := strings.TrimSpace(agentIDRaw)
	if raw == "" {
		b.ClearMobileViewer()
		return
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		b.ClearMobileViewer()
		return
	}
	b.SetMobileViewer(id)
}

// SetMobileViewer records that the phone is viewing agentID (heartbeat refreshes TTL).
func (b *Bridge) SetMobileViewer(agentID int64) {
	if b == nil || agentID <= 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.mobileViewerAgentID = agentID
	b.mobileViewerAt = time.Now()
}

// ClearMobileViewer clears phone viewing presence.
func (b *Bridge) ClearMobileViewer() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.mobileViewerAgentID = 0
	b.mobileViewerAt = time.Time{}
}

// MobileViewingAgentID returns the agent the phone is viewing if still within TTL.
func (b *Bridge) MobileViewingAgentID() (int64, bool) {
	if b == nil {
		return 0, false
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.mobileViewerAgentID <= 0 || b.mobileViewerAt.IsZero() {
		return 0, false
	}
	if time.Since(b.mobileViewerAt) > mobileViewerTTL {
		return 0, false
	}
	return b.mobileViewerAgentID, true
}

// handleViewerSet records phone chat presence for one agent.
func handleViewerSet(ec *ExecContext) (any, error) {
	if ec.Viewer == nil {
		return nil, fmt.Errorf("viewer not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	ec.Viewer.SetMobileViewer(agentID)
	// 仅记录手机正在看谁（Bark 抑制 + 终态时跳过写入未读）。
	// 历史未读须走 agents.mark_read；禁止心跳误清旧未读。
	return map[string]any{
		"ok":       true,
		"agent_id": strconv.FormatInt(agentID, 10),
	}, nil
}

// handleViewerClear clears phone chat presence.
func handleViewerClear(ec *ExecContext) (any, error) {
	if ec.Viewer == nil {
		return nil, fmt.Errorf("viewer not configured")
	}
	ec.Viewer.ClearMobileViewer()
	return map[string]any{"ok": true}, nil
}
