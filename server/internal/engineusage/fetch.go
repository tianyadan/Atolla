package engineusage

import (
	"context"
	"sync"
	"time"
)

var (
	cacheMu       sync.Mutex
	cacheResp     *Response
	cacheAt       time.Time
	fetching      bool
	fetchWait     = make(chan struct{})
	testHome      string
	testCodexHome string
)

// SetHomeDir 仅供测试注入主目录。
func SetHomeDir(dir string) { testHome = dir }

// SetCodexHome 仅供测试注入 CODEX_HOME。
func SetCodexHome(dir string) { testCodexHome = dir }

// ClearCacheForTest 清空内存缓存，仅供测试。
func ClearCacheForTest() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cacheResp = nil
	cacheAt = time.Time{}
}

// FetchAll 拉取 Claude/Codex/Cursor 配额（5 分钟内存缓存，三家一次聚合）。
// force 为 true 时跳过缓存（「重新检查环境」）。
func FetchAll(ctx context.Context, force bool) Response {
	for {
		cacheMu.Lock()
		if !force && cacheResp != nil && time.Since(cacheAt) < cacheTTL {
			out := cloneResponse(*cacheResp)
			out.TTLSeconds = int(cacheTTL.Seconds())
			cacheMu.Unlock()
			return out
		}
		if fetching {
			wait := fetchWait
			cacheMu.Unlock()
			select {
			case <-wait:
			case <-ctx.Done():
				return Response{
					CachedAt:   time.Now().UTC(),
					TTLSeconds: int(cacheTTL.Seconds()),
					Engines: []EngineUsage{
						{ID: "claude", Error: "cancelled"},
						{ID: "codex", Error: "cancelled"},
						{ID: "cursor", Error: "cancelled"},
					},
				}
			}
			// 别人刚刷完：再走一遍（非 force 会直接命中缓存）。
			continue
		}
		fetching = true
		fetchWait = make(chan struct{})
		cacheMu.Unlock()
		break
	}

	defer func() {
		cacheMu.Lock()
		fetching = false
		close(fetchWait)
		cacheMu.Unlock()
	}()

	type slot struct {
		idx int
		e   EngineUsage
	}
	ch := make(chan slot, 3)
	go func() { ch <- slot{0, fetchClaude(ctx)} }()
	go func() { ch <- slot{1, fetchCodex(ctx)} }()
	go func() { ch <- slot{2, fetchCursor(ctx)} }()
	engines := make([]EngineUsage, 3)
	for i := 0; i < 3; i++ {
		s := <-ch
		engines[s.idx] = s.e
	}

	now := time.Now().UTC()
	resp := Response{
		CachedAt:   now,
		TTLSeconds: int(cacheTTL.Seconds()),
		Engines:    engines,
	}

	cacheMu.Lock()
	cacheResp = &resp
	cacheAt = now
	cacheMu.Unlock()

	return cloneResponse(resp)
}

func cloneResponse(in Response) Response {
	out := in
	out.Engines = make([]EngineUsage, len(in.Engines))
	for i, e := range in.Engines {
		out.Engines[i] = e
		if len(e.Windows) > 0 {
			out.Engines[i].Windows = append([]UsageWindow(nil), e.Windows...)
		}
	}
	return out
}
