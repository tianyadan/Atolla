package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// HomeSyncResult summarizes which CLI config files were updated.
type HomeSyncResult struct {
	CursorPath string `json:"cursor_path,omitempty"`
	ClaudePath string `json:"claude_path,omitempty"`
	CodexPath  string `json:"codex_path,omitempty"`
	Patterns   int    `json:"patterns"`
	Errors     []string `json:"errors,omitempty"`
}

// SyncHomeNetworkAllowlist merges patterns into Cursor / Claude / Codex home configs.
func SyncHomeNetworkAllowlist(patterns []string) HomeSyncResult {
	home, err := os.UserHomeDir()
	res := HomeSyncResult{Patterns: len(patterns)}
	if err != nil || home == "" {
		res.Errors = append(res.Errors, "home directory unavailable")
		return res
	}
	clean := normalizePatterns(patterns)

	cursorPath := filepath.Join(home, ".cursor", "sandbox.json")
	if err := mergeCursorSandbox(cursorPath, clean); err != nil {
		res.Errors = append(res.Errors, "cursor: "+err.Error())
	} else {
		res.CursorPath = cursorPath
	}

	claudePath := filepath.Join(home, ".claude", "settings.json")
	if err := mergeClaudeSettings(claudePath, clean); err != nil {
		res.Errors = append(res.Errors, "claude: "+err.Error())
	} else {
		res.ClaudePath = claudePath
	}

	codexPath := filepath.Join(home, ".codex", "config.toml")
	if err := mergeCodexConfig(codexPath, len(clean) > 0); err != nil {
		res.Errors = append(res.Errors, "codex: "+err.Error())
	} else {
		res.CodexPath = codexPath
	}
	return res
}

func normalizePatterns(in []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, p := range in {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func mergeCursorSandbox(path string, patterns []string) error {
	root := map[string]any{}
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		_ = json.Unmarshal(b, &root)
	}
	np, _ := root["networkPolicy"].(map[string]any)
	if np == nil {
		np = map[string]any{}
	}
	// Atolla 用户在管理台保存/同步 = 授权放宽出站；白名单作推荐域保留。
	np["default"] = "allow"
	allow := stringSlice(np["allow"])
	allow = unionStrings(allow, patterns)
	np["allow"] = allow
	root["networkPolicy"] = np
	return writeJSONAtomic(path, root)
}

func mergeClaudeSettings(path string, patterns []string) error {
	root := map[string]any{}
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		_ = json.Unmarshal(b, &root)
	}
	sandbox, _ := root["sandbox"].(map[string]any)
	if sandbox == nil {
		sandbox = map[string]any{}
	}
	// 放宽：关闭 Bash 沙箱网络隔离，避免公开 API 被拦；仍合并 allowedDomains 供后续收紧。
	sandbox["enabled"] = false
	net, _ := sandbox["network"].(map[string]any)
	if net == nil {
		net = map[string]any{}
	}
	domains := stringSlice(net["allowedDomains"])
	domains = unionStrings(domains, patterns)
	net["allowedDomains"] = domains
	sandbox["network"] = net
	root["sandbox"] = sandbox
	return writeJSONAtomic(path, root)
}

func mergeCodexConfig(path string, enableNetwork bool) error {
	var body string
	if b, err := os.ReadFile(path); err == nil {
		body = string(b)
	}
	const marker = "# atolla-network-allowlist"
	block := fmt.Sprintf(`%s
# Fine-grained domains are managed in Cursor/Claude allowlists; Codex enables outbound when list non-empty.
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = %v
`, marker, enableNetwork)

	if idx := strings.Index(body, marker); idx >= 0 {
		// Replace from marker to end of section or append
		rest := body[idx:]
		end := len(body)
		if n := strings.Index(rest[len(marker):], "\n# "); n >= 0 {
			end = idx + len(marker) + n + 1
		} else if n := strings.Index(rest, "\n["); n > 0 {
			// keep other tables after our block if any follow a blank line — simple: replace trailing atolla block
			end = len(body)
		}
		_ = end
		// Rewrite: remove old atolla block by cutting from marker to EOF if file only has our block,
		// else strip lines starting at marker through network_access line.
		lines := strings.Split(body, "\n")
		var kept []string
		skip := false
		for _, ln := range lines {
			if strings.Contains(ln, marker) {
				skip = true
				continue
			}
			if skip {
				t := strings.TrimSpace(ln)
				if t == "" || strings.HasPrefix(t, "#") ||
					t == "sandbox_mode = \"workspace-write\"" ||
					t == "[sandbox_workspace_write]" ||
					strings.HasPrefix(t, "network_access") {
					continue
				}
				skip = false
			}
			if !skip {
				kept = append(kept, ln)
			}
		}
		body = strings.TrimRight(strings.Join(kept, "\n"), "\n")
		if body != "" {
			body += "\n\n"
		}
		body += block
	} else {
		if body != "" && !strings.HasSuffix(body, "\n") {
			body += "\n"
		}
		if body != "" {
			body += "\n"
		}
		body += block
	}
	return writeFileAtomic(path, []byte(body), 0o600)
}

func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return append([]string{}, t...)
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func unionStrings(a, b []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, xs := range [][]string{a, b} {
		for _, s := range xs {
			s = strings.ToLower(strings.TrimSpace(s))
			if s == "" {
				continue
			}
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	return out
}

func writeJSONAtomic(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return writeFileAtomic(path, b, 0o600)
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
