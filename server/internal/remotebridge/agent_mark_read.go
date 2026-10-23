package remotebridge

import (
	"fmt"
	"log"
	"strconv"
)

// handleAgentMarkRead 手机主动进入对话时清未读（非 viewer 心跳）。
func handleAgentMarkRead(ec *ExecContext) (any, error) {
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	if ec.Store == nil {
		return nil, fmt.Errorf("store not configured")
	}
	if err := ec.Store.ClearManagedAgentTaskUnread(ec.Context, agentID); err != nil {
		return nil, err
	}
	// 必须推镜像：App 列表读的是中继 agents_mirror，不是 Mac 本地库
	if ec.Client != nil {
		if _, err := handleSyncAgents(ec); err != nil {
			log.Printf("remotebridge agent.mark_read sync agents agent=%d: %v", agentID, err)
		}
	}
	return map[string]any{
		"ok":          true,
		"agent_id":    strconv.FormatInt(agentID, 10),
		"task_unread": false,
	}, nil
}
