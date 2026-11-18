package enginecheck

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const cacheTTL = 5 * time.Minute

// Engine 本机一个工作引擎的检测结果。
type Engine struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Bin       string `json:"bin"`
	Installed bool   `json:"installed"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Healthy   bool   `json:"healthy"`
	CheckedAt string `json:"checked_at"`
}

var scanCache struct {
	sync.Mutex
	at   time.Time
	list []Engine
}

// Scan 检查 Claude、Codex、Cursor 的 CLI 是否在 PATH 中。
func Scan() []Engine {
	return ScanCached(false)
}

// ScanCached 统一缓存版本与连接健康检查，避免页面切换和会话恢复反复启动 CLI。
func ScanCached(force bool) []Engine {
	scanCache.Lock()
	defer scanCache.Unlock()
	if !force && !scanCache.at.IsZero() && time.Since(scanCache.at) < cacheTTL {
		return append([]Engine(nil), scanCache.list...)
	}
	list := []Engine{
		probe("claude", "Claude", "claude"),
		probe("codex", "Codex", "codex"),
		probe("cursor", "Cursor", "agent", "cursor-agent"),
	}
	scanCache.at = time.Now()
	scanCache.list = list
	return append([]Engine(nil), list...)
}

// probe 按候选命令名依次查找，命中任一即视为已安装。
func probe(id, name string, bins ...string) Engine {
	out := Engine{ID: id, Name: name, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	if len(bins) > 0 {
		out.Bin = bins[0]
	}
	for _, bin := range bins {
		p, err := exec.LookPath(bin)
		if err == nil && p != "" {
			out.Installed = true
			out.Bin = bin
			out.Path = p
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			cmd := exec.CommandContext(ctx, p, "--version")
			cmd.Env = append(os.Environ(), "NO_UPDATE_NOTIFIER=1", "DISABLE_AUTOUPDATER=1", "DISABLE_UPDATES=1", "CURSOR_AGENT_DISABLE_UPDATE=1")
			version, versionErr := cmd.CombinedOutput()
			cancel()
			out.Version = strings.TrimSpace(string(version))
			out.Healthy = versionErr == nil
			return out
		}
	}
	return out
}
