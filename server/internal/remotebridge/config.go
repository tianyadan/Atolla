package remotebridge

import (
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
}

// PublicConfig is returned by admin GET (no password plaintext).
type PublicConfig struct {
	Enabled      bool   `json:"enabled"`
	BaseURL      string `json:"base_url"`
	InstanceID   string `json:"instance_id"`
	DisplayName  string `json:"display_name"`
	HasPassword  bool   `json:"has_password"`
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

// defaultInstanceID uses hostname or a stable fallback.
func defaultInstanceID() string {
	h, err := os.Hostname()
	h = strings.TrimSpace(h)
	if err != nil || h == "" {
		return "atolla-mac"
	}
	return h
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

// SetPassword stores a new password and persists.
func (cs *ConfigStore) SetPassword(plain string) error {
	if !ValidInstancePassword(plain) {
		return fmt.Errorf("invalid instance password format")
	}
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.cfg.Password = plain
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
