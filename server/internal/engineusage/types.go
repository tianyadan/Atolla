package engineusage

import "time"

// cacheTTL 三家 CLI 共用内存缓存；打开设置页不强制刷新。
const cacheTTL = 5 * time.Minute

// Response 是 GET /api/admin/engines/usage 的响应体。
type Response struct {
	CachedAt   time.Time     `json:"cached_at"`
	TTLSeconds int           `json:"ttl_seconds"`
	Engines    []EngineUsage `json:"engines"`
}

// EngineUsage 单个引擎的配额窗口汇总。
type EngineUsage struct {
	ID      string        `json:"id"`
	OK      bool          `json:"ok"`
	Error   string        `json:"error"`
	Source  string        `json:"source"`
	Plan    string        `json:"plan"`
	Windows []UsageWindow `json:"windows"`
}

// UsageWindow 一条滚动或账单周期限额。
type UsageWindow struct {
	Kind          string `json:"kind"`
	Label         string `json:"label"`
	Hint          string `json:"hint"`
	UsedPercent   int    `json:"used_percent"`
	WindowMinutes int    `json:"window_minutes"`
	ResetsAt      string `json:"resets_at"`
	ResetHint     string `json:"reset_hint"`
}
