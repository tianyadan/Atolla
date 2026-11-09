package remotebridge

import (
	"sync"
	"time"
)

// AgentLiveStatus 是数字员工当前运行态摘要（供 agents mirror / 灵动岛使用）。
type AgentLiveStatus struct {
	Phase     string `json:"phase"`
	Tool      string `json:"tool"`
	Summary   string `json:"summary"`
	UpdatedAt int64  `json:"updated_at"`
}

var agentLiveMu sync.RWMutex
var agentLive = map[int64]AgentLiveStatus{}

// SetAgentLive 更新某数字员工的即时阶段/工具活动。
func SetAgentLive(agentID int64, phase, tool, summary string) {
	if agentID <= 0 {
		return
	}
	agentLiveMu.Lock()
	defer agentLiveMu.Unlock()
	cur := agentLive[agentID]
	if phase != "" {
		cur.Phase = phase
	}
	if tool != "" {
		cur.Tool = tool
	}
	if summary != "" {
		cur.Summary = summary
	}
	cur.UpdatedAt = time.Now().Unix()
	agentLive[agentID] = cur
}

// ClearAgentLive 任务结束后清空即时态，避免手机看到过期「正在…」。
func ClearAgentLive(agentID int64) {
	if agentID <= 0 {
		return
	}
	agentLiveMu.Lock()
	defer agentLiveMu.Unlock()
	delete(agentLive, agentID)
}

// GetAgentLive 读取即时态；无记录时 ok=false。
func GetAgentLive(agentID int64) (AgentLiveStatus, bool) {
	agentLiveMu.RLock()
	defer agentLiveMu.RUnlock()
	st, ok := agentLive[agentID]
	return st, ok
}
