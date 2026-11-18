package service

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"atolla/server/internal/store"
)

// EngineModelItem 下拉选项（id 原样传给 CLI）。
type EngineModelItem struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// EngineModelsCatalog 某引擎可选模型目录。
type EngineModelsCatalog struct {
	Engine       string            `json:"engine"`
	Source       string            `json:"source"` // cli | cache | docs | none
	AllowCustom  bool              `json:"allow_custom"`
	Default      string            `json:"default,omitempty"`
	Detail       string            `json:"detail,omitempty"`
	Items        []EngineModelItem `json:"items"`
}

// ListEngineModels 按引擎探测官方/本机模型列表；失败时仍允许自定义。
func (s *Service) ListEngineModels(ctx context.Context, engine string) EngineModelsCatalog {
	eng := store.RepairEngineName(engine)
	out := EngineModelsCatalog{
		Engine:      eng,
		AllowCustom: true,
		Items:       []EngineModelItem{},
	}
	switch eng {
	case "agent":
		return listCursorAgentModels(ctx, out)
	case "codex":
		return listCodexModels(out)
	case "claude":
		return listClaudeModels(ctx, out)
	default:
		out.Source = "none"
		out.Detail = "unknown engine"
		return out
	}
}

// listCursorAgentModels 跑 `agent models`（账号相关）。
func listCursorAgentModels(ctx context.Context, out EngineModelsCatalog) EngineModelsCatalog {
	cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "agent", "models")
	cmd.Env = os.Environ()
	raw, err := cmd.CombinedOutput()
	if err != nil {
		out.Source = "none"
		out.Detail = strings.TrimSpace(string(raw))
		if out.Detail == "" {
			out.Detail = err.Error()
		}
		return out
	}
	items, def := parseAgentModelsOutput(string(raw))
	out.Source = "cli"
	out.Items = items
	out.Default = def
	if len(items) == 0 {
		out.Detail = "agent models returned no entries"
	}
	return out
}

// parseAgentModelsOutput 解析 `id - label` 行（跳过标题）。
func parseAgentModelsOutput(raw string) ([]EngineModelItem, string) {
	var items []EngineModelItem
	def := ""
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.EqualFold(line, "Available models") {
			continue
		}
		id, label, ok := splitModelDashLine(line)
		if !ok {
			continue
		}
		if strings.Contains(strings.ToLower(label), "default") || strings.Contains(strings.ToLower(label), "current") {
			def = id
		}
		items = append(items, EngineModelItem{ID: id, Label: label})
	}
	return items, def
}

// splitModelDashLine 拆 `id - label`（首个 " - "）。
func splitModelDashLine(line string) (id, label string, ok bool) {
	idx := strings.Index(line, " - ")
	if idx <= 0 {
		return "", "", false
	}
	id = strings.TrimSpace(line[:idx])
	label = strings.TrimSpace(line[idx+3:])
	if id == "" {
		return "", "", false
	}
	if label == "" {
		label = id
	}
	return id, label, true
}

// listCodexModels 优先读 ~/.codex/models_cache.json（visibility=list）。
func listCodexModels(out EngineModelsCatalog) EngineModelsCatalog {
	path := codexModelsCachePath()
	raw, err := os.ReadFile(path)
	if err != nil {
		out.Source = "docs"
		out.Items = codexDocsFallbackModels()
		out.Detail = "models_cache missing; using docs snapshot"
		return out
	}
	items, err := parseCodexModelsCache(raw)
	if err != nil || len(items) == 0 {
		out.Source = "docs"
		out.Items = codexDocsFallbackModels()
		out.Detail = "models_cache unusable; using docs snapshot"
		return out
	}
	out.Source = "cache"
	out.Items = items
	return out
}

func codexModelsCachePath() string {
	if h := strings.TrimSpace(os.Getenv("CODEX_HOME")); h != "" {
		return filepath.Join(h, "models_cache.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".codex", "models_cache.json")
}

func parseCodexModelsCache(raw []byte) ([]EngineModelItem, error) {
	var payload struct {
		Models []struct {
			Slug        string `json:"slug"`
			DisplayName string `json:"display_name"`
			Description string `json:"description"`
			Visibility  string `json:"visibility"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	items := make([]EngineModelItem, 0, len(payload.Models))
	for _, m := range payload.Models {
		if strings.TrimSpace(m.Slug) == "" {
			continue
		}
		if vis := strings.ToLower(strings.TrimSpace(m.Visibility)); vis != "" && vis != "list" {
			continue
		}
		label := strings.TrimSpace(m.DisplayName)
		if label == "" {
			label = m.Slug
		}
		if d := strings.TrimSpace(m.Description); d != "" {
			label = label + " — " + d
		}
		items = append(items, EngineModelItem{ID: m.Slug, Label: label})
	}
	return items, nil
}

// codexDocsFallbackModels 官方 Learn/本地缓存常见可见 id（无 cache 时兜底）。
func codexDocsFallbackModels() []EngineModelItem {
	return []EngineModelItem{
		{ID: "gpt-6.2-sol", Label: "GPT-6.2-Sol — Fast, everyday coding"},
		{ID: "gpt-6.2-astra", Label: "GPT-6.2-Astra — Complex / professional"},
		{ID: "gpt-6.1-terra", Label: "GPT-6.1 Terra — Visual / computer use"},
		{ID: "gpt-6.1-sol", Label: "GPT-6.1-Sol — Previous-gen everyday"},
		{ID: "gpt-6-astra", Label: "GPT-6-Astra — Previous-gen complex"},
		{ID: "gpt-6-sol", Label: "GPT-6-Sol — Legacy everyday"},
		{ID: "gpt-6-luna", Label: "GPT-6-Luna — Fast / easier tasks"},
		{ID: "gpt-5.6-sol", Label: "GPT-5.6-Sol — Legacy everyday"},
		{ID: "gpt-5.6-terra", Label: "GPT-5.6-Terra — Legacy balanced"},
		{ID: "gpt-5.6-luna", Label: "GPT-5.6-Luna — Legacy fast"},
	}
}

// listClaudeModels 优先 Anthropic /v1/models；否则官方 alias + 强制自定义。
func listClaudeModels(ctx context.Context, out EngineModelsCatalog) EngineModelsCatalog {
	out.AllowCustom = true
	if key := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")); key != "" {
		if items, err := fetchAnthropicModels(ctx, key); err == nil && len(items) > 0 {
			out.Source = "api"
			out.Items = items
			return out
		}
	}
	out.Source = "docs"
	out.Items = claudeDocsAliasModels()
	out.Detail = "alias list; custom id required for ccswitch / gateways"
	return out
}

func claudeDocsAliasModels() []EngineModelItem {
	return []EngineModelItem{
		{ID: "sonnet", Label: "sonnet (alias)"},
		{ID: "opus", Label: "opus (alias)"},
		{ID: "haiku", Label: "haiku (alias)"},
	}
}

func fetchAnthropicModels(ctx context.Context, apiKey string) ([]EngineModelItem, error) {
	cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("anthropic models: HTTP %d", res.StatusCode)
	}
	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	items := make([]EngineModelItem, 0, len(payload.Data))
	for _, m := range payload.Data {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		label := strings.TrimSpace(m.DisplayName)
		if label == "" {
			label = id
		}
		items = append(items, EngineModelItem{ID: id, Label: label})
	}
	return items, nil
}
