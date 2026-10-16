package remotebridge

import (
	"fmt"

	"atolla/server/internal/store"
)

// payloadBool 读取 JSON 布尔字段。缺字段或类型不对时 ok 为 false。
func payloadBool(payload map[string]interface{}, key string) (bool, bool) {
	v, ok := payload[key].(bool)
	if !ok {
		return false, false
	}
	return v, true
}

// handleNotifyPrefsGet 返回完成通知与命令审批通知开关。
func handleNotifyPrefsGet(ec *ExecContext) (any, error) {
	if ec == nil || ec.Store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	return ec.Store.GetNotifyPrefs(ec.Context)
}

// handleNotifyPrefsUpdate 保存两条通知开关，并回读结果。
func handleNotifyPrefsUpdate(ec *ExecContext) (any, error) {
	if ec == nil || ec.Store == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	taskDone, ok1 := payloadBool(ec.Payload, "task_done")
	permission, ok2 := payloadBool(ec.Payload, "permission")
	if !ok1 || !ok2 {
		return nil, fmt.Errorf("task_done and permission booleans required")
	}
	prefs := store.NotifyPrefs{TaskDone: taskDone, Permission: permission}
	if err := ec.Store.SaveNotifyPrefs(ec.Context, prefs); err != nil {
		return nil, err
	}
	return prefs, nil
}
