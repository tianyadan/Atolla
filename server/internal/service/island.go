package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// IslandConfig 本机灵动岛读取的凭证（不入库，只写 ~/.atolla 或工作区 .atolla）。
type IslandConfig struct {
	APIBase   string `json:"api_base"`
	WebBase   string `json:"web_base"`
	Token     string `json:"token"`
	UpdatedAt string `json:"updated_at"`
}

// IslandBusyAgent 岛上展示用的数字人摘要（忙碌 或 任务完成未读）。
type IslandBusyAgent struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Engine       string `json:"engine"`
	Status       string `json:"status"`
	JellyColor   string `json:"jelly_color"`
	Reason       string `json:"reason"`                  // direct | workflow | unread
	GroupName    string `json:"group_name"`              // 工作组名；空则未分组
	RunStartedAt string `json:"run_started_at,omitempty"` // RFC3339；空则无计时
	Unread       bool   `json:"unread"`                  // 任务完成待查看（非忙碌）
}

// SyncIslandConfig 把当前登录 Token 写到本机岛配置文件。
func (s *Service) SyncIslandConfig(token, apiBase, webBase string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", fmt.Errorf("token required")
	}
	apiBase = strings.TrimRight(strings.TrimSpace(apiBase), "/")
	if apiBase == "" {
		apiBase = strings.TrimRight(strings.TrimSpace(s.Cfg.BackendURL), "/")
	}
	if apiBase == "" {
		apiBase = "http://127.0.0.1:8080"
	}
	webBase = strings.TrimRight(strings.TrimSpace(webBase), "/")
	if webBase == "" {
		webBase = "http://127.0.0.1:5173"
	}
	cfg := IslandConfig{
		APIBase:   apiBase,
		WebBase:   webBase,
		Token:     token,
		UpdatedAt: time.Now().Format(time.RFC3339),
	}
	path := s.islandConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// ListIslandBusyAgents 返回忙碌数字人 + 任务完成未读（与侧栏「忙 / 未读」语义对齐）。
func (s *Service) ListIslandBusyAgents(ctx context.Context) ([]IslandBusyAgent, error) {
	items, err := s.Store.ListManagedAgents(ctx)
	if err != nil {
		return nil, err
	}
	items = s.EnrichAgentsFolderNames(ctx, items)
	occMap, _ := s.Store.ListOccupancyMap(ctx)
	out := make([]IslandBusyAgent, 0)
	for _, a := range items {
		reason := ""
		st := strings.ToLower(strings.TrimSpace(a.Status))
		if o, ok := occMap[a.ID]; ok {
			if o.SourceType == "WORKFLOW" || o.WorkflowRunID > 0 {
				reason = "workflow"
			}
		}
		busy := reason == "workflow" ||
			st == "running" || st == "busy" || st == "插话中" ||
			st == "initializing" || st == "compressing" || st == "waiting"
		unreadOnly := !busy && a.TaskUnread
		if !busy && !unreadOnly {
			continue
		}
		if busy {
			if reason == "" {
				reason = "direct"
			}
		} else {
			reason = "unread"
		}
		group := strings.TrimSpace(a.FolderName)
		if group == "" {
			group = "未分组"
		}
		started := ""
		if a.RunStartedAt != nil && !a.RunStartedAt.IsZero() {
			started = a.RunStartedAt.UTC().Format(time.RFC3339)
		}
		out = append(out, IslandBusyAgent{
			ID:           a.ID,
			Name:         a.Name,
			Engine:       a.Engine,
			Status:       a.Status,
			JellyColor:   a.JellyColor,
			Reason:       reason,
			GroupName:    group,
			RunStartedAt: started,
			Unread:       unreadOnly || (!busy && a.TaskUnread),
		})
	}
	return out, nil
}

// MarkAgentTaskRead 清除任务完成未读，并尽量刷新手机镜像。
func (s *Service) MarkAgentTaskRead(ctx context.Context, agentID int64) error {
	if agentID <= 0 {
		return fmt.Errorf("invalid agent id")
	}
	if err := s.Store.ClearManagedAgentTaskUnread(ctx, agentID); err != nil {
		return err
	}
	s.PushAgentsMirrorNow()
	return nil
}

func (s *Service) islandConfigPath() string {
	// 优先用户主目录，岛 App 固定读这里
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".atolla", "island.json")
	}
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	if root == "" {
		root = os.TempDir()
	}
	return filepath.Join(root, ".atolla", "island.json")
}
