package enginecheck

import "os/exec"

// Engine 本机一个工作引擎的检测结果。
type Engine struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Bin       string `json:"bin"`
	Installed bool   `json:"installed"`
	Path      string `json:"path,omitempty"`
}

// Scan 检查 Claude、Codex、Cursor 的 CLI 是否在 PATH 中。
func Scan() []Engine {
	return []Engine{
		probe("claude", "Claude", "claude"),
		probe("codex", "Codex", "codex"),
		probe("cursor", "Cursor", "agent", "cursor-agent"),
	}
}

// probe 按候选命令名依次查找，命中任一即视为已安装。
func probe(id, name string, bins ...string) Engine {
	out := Engine{ID: id, Name: name}
	if len(bins) > 0 {
		out.Bin = bins[0]
	}
	for _, bin := range bins {
		p, err := exec.LookPath(bin)
		if err == nil && p != "" {
			out.Installed = true
			out.Bin = bin
			out.Path = p
			return out
		}
	}
	return out
}
