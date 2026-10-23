package remotebridge

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// RegistryVersion is the action registry contract version (V1 = 1).
const RegistryVersion = 1

// Config persisted on disk for the outbound bridge.
type Config struct {
	Enabled     bool   `json:"enabled"`
	BaseURL     string `json:"base_url"`
	InstanceID  string `json:"instance_id"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password,omitempty"`
	// PendingPassword 是已经准备提交给中继、但尚未确认写回的新密码。先落盘再注册，进程在注册成功后退出时还能把它找回来。
	PendingPassword string `json:"pending_password,omitempty"`

	// SMTP：验证码登录发信（163 等）
	SmtpHost     string `json:"smtp_host,omitempty"`
	SmtpPort     int    `json:"smtp_port,omitempty"`
	SmtpUser     string `json:"smtp_user,omitempty"`
	SmtpPassword string `json:"smtp_password,omitempty"`
	SmtpFrom     string `json:"smtp_from,omitempty"`
	SmtpOk       bool   `json:"smtp_ok,omitempty"`
}

// PublicConfig is returned by admin GET (no password plaintext).
type PublicConfig struct {
	Enabled     bool   `json:"enabled"`
	BaseURL     string `json:"base_url"`
	InstanceID  string `json:"instance_id"`
	DisplayName string `json:"display_name"`
	HasPassword bool   `json:"has_password"`

	SmtpHost     string `json:"smtp_host,omitempty"`
	SmtpPort     int    `json:"smtp_port,omitempty"`
	SmtpUser     string `json:"smtp_user,omitempty"`
	SmtpFrom     string `json:"smtp_from,omitempty"`
	HasSmtpPass  bool   `json:"has_smtp_password"`
	SmtpOk       bool   `json:"smtp_ok"`
}

// ConfigStore loads and saves bridge settings under the Atolla data directory.
type ConfigStore struct {
	mu   sync.RWMutex
	path string
	cfg  Config
}

// NewConfigStore opens or creates config at workspaceRoot/.atolla/remote-relay.json.
func NewConfigStore(workspaceRoot string) (*ConfigStore, error) {
	root := strings.TrimSpace(workspaceRoot)
	if root == "" {
		root = os.TempDir()
	}
	dir := filepath.Join(root, ".atolla")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "remote-relay.json")
	cs := &ConfigStore{path: path}
	if err := cs.load(); err != nil {
		return nil, err
	}
	return cs, nil
}

func (cs *ConfigStore) load() error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	data, err := os.ReadFile(cs.path)
	if err != nil {
		if os.IsNotExist(err) {
			cs.cfg = defaultConfig()
			return cs.saveLocked()
		}
		return err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return fmt.Errorf("parse remote-relay config: %w", err)
	}
	if strings.TrimSpace(c.InstanceID) == "" {
		c.InstanceID = defaultInstanceID()
	}
	if strings.TrimSpace(c.DisplayName) == "" {
		c.DisplayName = c.InstanceID
	}
	cs.cfg = c
	return nil
}

func defaultConfig() Config {
	id := defaultInstanceID()
	return Config{
		InstanceID:  id,
		DisplayName: id,
	}
}

// defaultInstanceID returns a random UUID persisted in bridge config (stable across restarts).
func defaultInstanceID() string {
	return newRandomUUID()
}

func newRandomUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("atolla-%d", os.Getpid())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16],
	)
}

func (cs *ConfigStore) saveLocked() error {
	data, err := json.MarshalIndent(cs.cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := cs.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, cs.path)
}

// Get returns a copy of the full config (includes password).
func (cs *ConfigStore) Get() Config {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return cs.cfg
}

// Public returns admin-safe config.
func (cs *ConfigStore) Public() PublicConfig {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return PublicConfig{
		Enabled:     cs.cfg.Enabled,
		BaseURL:     cs.cfg.BaseURL,
		InstanceID:  cs.cfg.InstanceID,
		DisplayName: cs.cfg.DisplayName,
		HasPassword: strings.TrimSpace(cs.cfg.Password) != "",
		SmtpHost:    cs.cfg.SmtpHost,
		SmtpPort:    cs.cfg.SmtpPort,
		SmtpUser:    cs.cfg.SmtpUser,
		SmtpFrom:    cs.cfg.SmtpFrom,
		HasSmtpPass: strings.TrimSpace(cs.cfg.SmtpPassword) != "",
		SmtpOk:      cs.cfg.SmtpOk,
	}
}

// Update merges admin PUT fields and persists.
func (cs *ConfigStore) Update(patch Config) (Config, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.cfg.Enabled = patch.Enabled
	if s := strings.TrimSpace(patch.BaseURL); s != "" {
		cs.cfg.BaseURL = strings.TrimRight(s, "/")
	}
	if s := strings.TrimSpace(patch.InstanceID); s != "" {
		cs.cfg.InstanceID = s
	}
	if s := strings.TrimSpace(patch.DisplayName); s != "" {
		cs.cfg.DisplayName = s
	}
	if s := strings.TrimSpace(patch.Password); s != "" {
		if !ValidInstancePassword(s) {
			return cs.cfg, fmt.Errorf("invalid instance password format")
		}
		cs.cfg.Password = s
		cs.cfg.PendingPassword = ""
	}
	// SMTP：有提交字段则更新；密码空字符串表示不改；仅实际变更时清 smtp_ok
	smtpChanged := false
	if s := strings.TrimSpace(patch.SmtpHost); s != "" && s != cs.cfg.SmtpHost {
		cs.cfg.SmtpHost = s
		smtpChanged = true
	}
	if patch.SmtpPort > 0 && patch.SmtpPort != cs.cfg.SmtpPort {
		cs.cfg.SmtpPort = patch.SmtpPort
		smtpChanged = true
	}
	if s := strings.TrimSpace(patch.SmtpUser); s != "" && s != cs.cfg.SmtpUser {
		cs.cfg.SmtpUser = s
		smtpChanged = true
	}
	if s := strings.TrimSpace(patch.SmtpFrom); s != "" && s != cs.cfg.SmtpFrom {
		cs.cfg.SmtpFrom = s
		smtpChanged = true
	}
	if s := strings.TrimSpace(patch.SmtpPassword); s != "" && s != cs.cfg.SmtpPassword {
		cs.cfg.SmtpPassword = s
		smtpChanged = true
	}
	if smtpChanged {
		cs.cfg.SmtpOk = false
	}
	if strings.TrimSpace(cs.cfg.InstanceID) == "" {
		cs.cfg.InstanceID = defaultInstanceID()
	}
	if strings.TrimSpace(cs.cfg.DisplayName) == "" {
		cs.cfg.DisplayName = cs.cfg.InstanceID
	}
	if err := cs.saveLocked(); err != nil {
		return cs.cfg, err
	}
	return cs.cfg, nil
}

/** SmtpConfigured 发送邮箱字段是否齐全 */
func (c Config) SmtpConfigured() bool {
	port := c.SmtpPort
	if port <= 0 {
		port = 465
	}
	return strings.TrimSpace(c.SmtpHost) != "" &&
		strings.TrimSpace(c.SmtpUser) != "" &&
		strings.TrimSpace(c.SmtpPassword) != "" &&
		strings.TrimSpace(c.SmtpFrom) != "" &&
		port > 0
}

/** SetSmtpOk 持久化 SMTP 校验结果 */
func (cs *ConfigStore) SetSmtpOk(ok bool) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.cfg.SmtpOk = ok
	return cs.saveLocked()
}

// SetPassword stores a new password and persists.
func (cs *ConfigStore) SetPassword(plain string) error {
	if !ValidInstancePassword(plain) {
		return fmt.Errorf("invalid instance password format")
	}
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.cfg.Password = plain
	cs.cfg.PendingPassword = ""
	return cs.saveLocked()
}

// StagePendingPassword 在向中继提交新密码之前把明文写进配置文件，当前密码保持不变。
func (cs *ConfigStore) StagePendingPassword(plain string) error {
	if !ValidInstancePassword(plain) {
		return fmt.Errorf("invalid instance password format")
	}
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.cfg.PendingPassword = plain
	return cs.saveLocked()
}

// ClearPendingPassword 丢掉尚未被中继接受的待定密码。
func (cs *ConfigStore) ClearPendingPassword() error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if strings.TrimSpace(cs.cfg.PendingPassword) == "" {
		return nil
	}
	cs.cfg.PendingPassword = ""
	return cs.saveLocked()
}

// Ready reports whether bridge can run (enabled + base URL + password).
func (cs *ConfigStore) Ready() bool {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return cs.cfg.Enabled &&
		strings.TrimSpace(cs.cfg.BaseURL) != "" &&
		ValidInstancePassword(cs.cfg.Password)
}
