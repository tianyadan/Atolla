package remotebridge

import (
	"atolla/server/internal/engineusage"
)

// handleEnginesUsageGet 返回本机三家 CLI 订阅额度（走 engineusage 5 分钟缓存）。
// payload.fresh=true|1 时强制刷新。
func handleEnginesUsageGet(ec *ExecContext) (any, error) {
	force := false
	if ec != nil && ec.Payload != nil {
		switch v := ec.Payload["fresh"].(type) {
		case bool:
			force = v
		case string:
			force = v == "1" || v == "true" || v == "yes"
		case float64:
			force = v != 0
		}
	}
	ctx := ec.Context
	return engineusage.FetchAll(ctx, force), nil
}
