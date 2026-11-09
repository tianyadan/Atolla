package githubidea

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	pluginID           = "github-idea"
	githubTokenKey     = "github-token"
	webhookSecretKey   = "webhook-secret"
	maxErrorLogEntries = 20
)

var repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

// ErrorLog 是插件自己的错误记录，不与 Atolla 主进程日志混在一起。
type ErrorLog struct {
	At      time.Time `json:"at"`
	Message string    `json:"message"`
}

type diskConfig struct {
	Enabled    bool       `json:"enabled"`
	Repository string     `json:"repository"`
	AgentIDs   []int64    `json:"agent_ids"`
	LastSyncAt *time.Time `json:"last_sync_at,omitempty"`
	LastError  string     `json:"last_error,omitempty"`
	ErrorLogs  []ErrorLog `json:"error_logs,omitempty"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// ConfigUpdate 是管理台允许更新的 GitHub Idea 配置。凭据留空表示保留原值。
type ConfigUpdate struct {
	Enabled       bool    `json:"enabled"`
	Repository    string  `json:"repository"`
	GitHubToken   string  `json:"github_token"`
	WebhookSecret string  `json:"webhook_secret"`
	AgentIDs      []int64 `json:"agent_ids"`
}

// PublicConfig 只暴露凭据是否存在，永不返回明文。
type PublicConfig struct {
	Enabled          bool       `json:"enabled"`
	Repository       string     `json:"repository"`
	AgentIDs         []int64    `json:"agent_ids"`
	HasGitHubToken   bool       `json:"has_github_token"`
	HasWebhookSecret bool       `json:"has_webhook_secret"`
	Status           string     `json:"status"`
	LastSyncAt       *time.Time `json:"last_sync_at,omitempty"`
	UpdatedAt        *time.Time `json:"updated_at,omitempty"`
	LastError        string     `json:"last_error,omitempty"`
	ErrorLogs        []ErrorLog `json:"error_logs"`
}

// SecretStore 隔离系统凭据实现，测试中可替换为内存实现。
type SecretStore interface {
	Get(ctx context.Context, key string) (string, bool, error)
	Set(ctx context.Context, key, value string) error
}

type macOSKeychain struct{}

func (macOSKeychain) Get(ctx context.Context, key string) (string, bool, error) {
	cmd := exec.CommandContext(ctx, "security", "find-generic-password", "-a", pluginID, "-s", keychainService(key), "-w")
	out, err := cmd.CombinedOutput()
	if err == nil {
		return strings.TrimSpace(string(out)), true, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && (exitErr.ExitCode() == 44 || strings.Contains(strings.ToLower(string(out)), "could not be found")) {
		return "", false, nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return "", false, fmt.Errorf("macOS Keychain 工具不可用")
	}
	return "", false, fmt.Errorf("读取 macOS Keychain 失败: %s", strings.TrimSpace(string(out)))
}

func (macOSKeychain) Set(ctx context.Context, key, value string) error {
	cmd := exec.CommandContext(ctx, "security", "add-generic-password", "-U", "-a", pluginID, "-s", keychainService(key), "-w", value)
	if out, err := cmd.CombinedOutput(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return fmt.Errorf("macOS Keychain 工具不可用")
		}
		return fmt.Errorf("写入 macOS Keychain 失败: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func keychainService(key string) string { return "com.atolla.plugin.github-idea." + key }

// Manager 管理插件配置、凭据和运行状态；后续同步器直接复用该边界。
type Manager struct {
	mu         sync.RWMutex
	path       string
	dedupPath  string
	secrets    SecretStore
	cfg        diskConfig
	dedup      map[string]dedupRecord
	httpClient httpDoer
	apiBase    string
	loadErr    error
}

// NewManager 从 .atolla/plugins 加载配置；加载失败保留为可展示状态，不阻塞主服务启动。
func NewManager(workspaceRoot string) *Manager {
	return newManager(workspaceRoot, macOSKeychain{})
}

// NewManagerWithSecretStore 允许其它安全凭据实现复用插件；生产默认仍使用 macOS Keychain。
func NewManagerWithSecretStore(workspaceRoot string, secrets SecretStore) *Manager {
	if secrets == nil {
		secrets = macOSKeychain{}
	}
	return newManager(workspaceRoot, secrets)
}

func newManager(workspaceRoot string, secrets SecretStore) *Manager {
	root := strings.TrimSpace(workspaceRoot)
	if root == "" {
		root = os.TempDir()
	}
	dir := filepath.Join(root, ".atolla", "plugins")
	m := &Manager{
		path:       filepath.Join(dir, "github-idea.json"),
		dedupPath:  filepath.Join(dir, "github-idea-dedup.json"),
		secrets:    secrets,
		dedup:      map[string]dedupRecord{},
		httpClient: defaultHTTPClient(),
		apiBase:    "https://api.github.com",
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		m.loadErr = err
		return m
	}
	b, err := os.ReadFile(m.path)
	if errors.Is(err, os.ErrNotExist) {
		m.loadDedup()
		return m
	}
	if err != nil {
		m.loadErr = err
		return m
	}
	if err := json.Unmarshal(b, &m.cfg); err != nil {
		m.loadErr = fmt.Errorf("解析 GitHub Idea 配置失败: %w", err)
	}
	m.loadDedup()
	return m
}

// RecordSyncSuccess 更新最近同步时间，供设置页展示。
func (m *Manager) RecordSyncSuccess(at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg.LastSyncAt = &at
	m.cfg.LastError = ""
	return m.saveLocked()
}

// RecordError 写入插件独立错误日志；只保留最近 20 条。
func (m *Manager) RecordError(message string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg.ErrorLogs = append(m.cfg.ErrorLogs, ErrorLog{At: time.Now(), Message: message})
	m.cfg.LastError = message
	if len(m.cfg.ErrorLogs) > maxErrorLogEntries {
		m.cfg.ErrorLogs = append([]ErrorLog(nil), m.cfg.ErrorLogs[len(m.cfg.ErrorLogs)-maxErrorLogEntries:]...)
	}
	return m.saveLocked()
}

// Get 返回脱敏配置与当前运行状态。
func (m *Manager) Get(ctx context.Context) (PublicConfig, error) {
	m.mu.RLock()
	cfg := cloneConfig(m.cfg)
	loadErr := m.loadErr
	m.mu.RUnlock()

	_, hasToken, tokenErr := m.secrets.Get(ctx, githubTokenKey)
	_, hasWebhook, webhookErr := m.secrets.Get(ctx, webhookSecretKey)
	secretErr := errors.Join(tokenErr, webhookErr)
	out := publicConfig(cfg, hasToken, hasWebhook, errors.Join(loadErr, secretErr))
	if loadErr != nil {
		return out, loadErr
	}
	if secretErr != nil {
		return out, secretErr
	}
	return out, nil
}

// Update 校验并保存配置；新凭据先进入 Keychain，配置文件中不落明文。
func (m *Manager) Update(ctx context.Context, in ConfigUpdate) (PublicConfig, error) {
	in.Repository = strings.TrimSpace(in.Repository)
	in.AgentIDs = normalizeAgentIDs(in.AgentIDs)
	if in.Repository != "" && !repositoryPattern.MatchString(in.Repository) {
		return PublicConfig{}, fmt.Errorf("仓库格式应为 owner/repository")
	}
	if in.GitHubToken != "" {
		if err := m.secrets.Set(ctx, githubTokenKey, strings.TrimSpace(in.GitHubToken)); err != nil {
			return PublicConfig{}, err
		}
	}
	if in.WebhookSecret != "" {
		if err := m.secrets.Set(ctx, webhookSecretKey, strings.TrimSpace(in.WebhookSecret)); err != nil {
			return PublicConfig{}, err
		}
	}
	_, hasToken, err := m.secrets.Get(ctx, githubTokenKey)
	if err != nil {
		return PublicConfig{}, err
	}
	_, hasWebhook, err := m.secrets.Get(ctx, webhookSecretKey)
	if err != nil {
		return PublicConfig{}, err
	}
	if in.Enabled {
		switch {
		case in.Repository == "":
			return PublicConfig{}, fmt.Errorf("启用前请填写 GitHub 仓库")
		case !hasToken:
			return PublicConfig{}, fmt.Errorf("启用前请填写 GitHub 凭据")
		case !hasWebhook:
			return PublicConfig{}, fmt.Errorf("启用前请填写 Webhook Secret")
		case len(in.AgentIDs) == 0:
			return PublicConfig{}, fmt.Errorf("启用前请至少选择一个数字员工")
		}
	}

	now := time.Now()
	m.mu.Lock()
	m.cfg.Enabled = in.Enabled
	m.cfg.Repository = in.Repository
	m.cfg.AgentIDs = append([]int64(nil), in.AgentIDs...)
	m.cfg.UpdatedAt = now
	m.loadErr = nil
	if err := m.saveLocked(); err != nil {
		m.mu.Unlock()
		return PublicConfig{}, err
	}
	cfg := cloneConfig(m.cfg)
	m.mu.Unlock()
	return publicConfig(cfg, hasToken, hasWebhook, nil), nil
}

func (m *Manager) saveLocked() error {
	b, err := json.MarshalIndent(m.cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, m.path); err != nil {
		return err
	}
	return os.Chmod(m.path, 0o600)
}

func publicConfig(cfg diskConfig, hasToken, hasWebhook bool, stateErr error) PublicConfig {
	status := "disabled"
	lastError := ""
	if cfg.Enabled {
		status = "ready"
		switch {
		case strings.TrimSpace(cfg.Repository) == "":
			status, lastError = "error", "GitHub 仓库未配置"
		case !hasToken:
			status, lastError = "error", "GitHub 凭据不存在"
		case !hasWebhook:
			status, lastError = "error", "Webhook Secret 不存在"
		case len(cfg.AgentIDs) == 0:
			status, lastError = "error", "尚未配置数字员工"
		}
	}
	if stateErr != nil {
		status = "error"
		lastError = stateErr.Error()
	} else if cfg.Enabled && lastError == "" && strings.TrimSpace(cfg.LastError) != "" {
		status = "error"
		lastError = cfg.LastError
	}
	var updatedAt *time.Time
	if !cfg.UpdatedAt.IsZero() {
		t := cfg.UpdatedAt
		updatedAt = &t
	}
	logs := append([]ErrorLog(nil), cfg.ErrorLogs...)
	if len(logs) > maxErrorLogEntries {
		logs = logs[len(logs)-maxErrorLogEntries:]
	}
	return PublicConfig{
		Enabled: cfg.Enabled, Repository: cfg.Repository, AgentIDs: append([]int64(nil), cfg.AgentIDs...),
		HasGitHubToken: hasToken, HasWebhookSecret: hasWebhook, Status: status,
		LastSyncAt: cfg.LastSyncAt, UpdatedAt: updatedAt, LastError: lastError, ErrorLogs: logs,
	}
}

func normalizeAgentIDs(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func cloneConfig(in diskConfig) diskConfig {
	out := in
	out.AgentIDs = append([]int64(nil), in.AgentIDs...)
	out.ErrorLogs = append([]ErrorLog(nil), in.ErrorLogs...)
	return out
}
