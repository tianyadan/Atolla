package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// IslandSettingsStatus 设置页「灵动岛」状态（可缓存）。
type IslandSettingsStatus struct {
	Installed   bool   `json:"installed"`
	Enabled     bool   `json:"enabled"`
	HasSource   bool   `json:"has_source"`
	HasXcode    bool   `json:"has_xcode"`
	SourcePath  string `json:"source_path"`
	BinaryPath  string `json:"binary_path"`
	XcodeDetail string `json:"xcode_detail"`
	Detail      string `json:"detail"`
	Cached      bool   `json:"cached"`
	CheckedAt   string `json:"checked_at"`
	RepoHint    string `json:"repo_hint"`
}

type islandSettingsCacheFile struct {
	IslandSettingsStatus
}

// GetIslandSettingsStatus 读取灵动岛状态；默认用缓存，force 时重检。
func (s *Service) GetIslandSettingsStatus(force bool) (IslandSettingsStatus, error) {
	if !force {
		if c, ok := s.loadIslandSettingsCache(); ok {
			c.Cached = true
			return c, nil
		}
	}
	st, err := s.probeIslandSettings()
	if err != nil {
		return st, err
	}
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	_ = s.saveIslandSettingsCache(st)
	return st, nil
}

// InstallIsland 编译并安装 LaunchAgent；成功后刷新缓存。
func (s *Service) InstallIsland() (IslandSettingsStatus, error) {
	script, err := s.resolveIslandScript("scripts/install-launchagent.sh")
	if err != nil {
		return IslandSettingsStatus{
			Detail:   "未找到灵动岛源码目录 macos/AtollaIsland。请从仓库拉取该可选目录后再安装。",
			RepoHint: "colleague-avatar/macos/AtollaIsland",
		}, err
	}
	out, err := s.runIslandScript(script, nil, 15*time.Minute)
	if err != nil {
		st := IslandSettingsStatus{Detail: clipWatchdogDetail(trimDetail(out, err))}
		return st, fmt.Errorf("%s", st.Detail)
	}
	// 安装后强制重检并写缓存
	st, perr := s.probeIslandSettings()
	if perr != nil {
		return IslandSettingsStatus{Detail: strings.TrimSpace(out) + "\n" + perr.Error()}, perr
	}
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	if st.Detail == "" {
		st.Detail = "安装成功"
	}
	_ = s.saveIslandSettingsCache(st)
	// 顺带确保有凭证文件提示
	if _, err := os.Stat(s.islandConfigPath()); err != nil {
		st.Detail += "；请登录管理台一次以同步岛凭证"
	}
	return st, nil
}

// SetIslandEnabled 启用/关闭 LaunchAgent；不删除已编译二进制。
func (s *Service) SetIslandEnabled(enabled bool) (IslandSettingsStatus, error) {
	name := "scripts/uninstall-launchagent.sh"
	skipBuild := false
	if enabled {
		bin := filepath.Join(homeDir(), ".atolla", "bin", "AtollaIsland")
		if st, err := os.Stat(bin); err != nil || st.IsDir() {
			return s.InstallIsland()
		}
		name = "scripts/install-launchagent.sh"
		skipBuild = true // 已有二进制，只重新挂 LaunchAgent
	}
	script, err := s.resolveIslandScript(name)
	if err != nil {
		return IslandSettingsStatus{Detail: err.Error(), RepoHint: "colleague-avatar/macos/AtollaIsland"}, err
	}
	extraEnv := []string{}
	if skipBuild {
		extraEnv = append(extraEnv, "ATOLLA_ISLAND_SKIP_BUILD=1")
	}
	out, err := s.runIslandScriptEnv(script, nil, 15*time.Minute, extraEnv)
	if err != nil {
		st := IslandSettingsStatus{Detail: clipWatchdogDetail(trimDetail(out, err))}
		return st, fmt.Errorf("%s", st.Detail)
	}
	st, perr := s.probeIslandSettings()
	if perr != nil {
		return IslandSettingsStatus{Detail: trimDetail(out, perr)}, perr
	}
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	_ = s.saveIslandSettingsCache(st)
	return st, nil
}

func (s *Service) probeIslandSettings() (IslandSettingsStatus, error) {
	script, err := s.resolveIslandScript("scripts/status-island.sh")
	if err != nil {
		return IslandSettingsStatus{
			Installed: false,
			Enabled:   false,
			HasSource: false,
			Detail:    "未找到 macos/AtollaIsland 源码（可选组件）。可将该目录单独放到 GitHub 后 clone 到仓库 macos/AtollaIsland。",
			RepoHint:  "colleague-avatar/macos/AtollaIsland",
			BinaryPath: filepath.Join(homeDir(), ".atolla", "bin", "AtollaIsland"),
		}, nil
	}
	out, err := s.runIslandScript(script, nil, 30*time.Second)
	st := IslandSettingsStatus{RepoHint: "colleague-avatar/macos/AtollaIsland"}
	if err != nil {
		st.Detail = clipWatchdogDetail(trimDetail(out, err))
		return st, err
	}
	line := lastJSONLine(out)
	if uerr := json.Unmarshal([]byte(line), &st); uerr != nil {
		st.Detail = "无法解析状态: " + strings.TrimSpace(out)
		return st, uerr
	}
	st.RepoHint = "colleague-avatar/macos/AtollaIsland"
	return st, nil
}

func (s *Service) runIslandScript(script string, args []string, timeout time.Duration) (string, error) {
	return s.runIslandScriptEnv(script, args, timeout, nil)
}

func (s *Service) runIslandScriptEnv(script string, args []string, timeout time.Duration, extraEnv []string) (string, error) {
	_ = os.Chmod(script, 0o755)
	cmd := exec.Command(script, args...)
	if root, err := s.resolveIslandRoot(); err == nil {
		cmd.Dir = root
	}
	path := "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + os.Getenv("PATH")
	env := append(os.Environ(), "PATH="+path, "GIT_TERMINAL_PROMPT=0")
	env = append(env, extraEnv...)
	// 优先完整 Xcode
	for _, d := range []string{
		"/Applications/Xcode.app/Contents/Developer",
		"/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer",
	} {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			env = append(env, "DEVELOPER_DIR="+d)
			break
		}
	}
	cmd.Env = env
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		return buf.String(), err
	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return buf.String(), fmt.Errorf("island script timeout")
	}
}

func (s *Service) resolveIslandRoot() (string, error) {
	script, err := s.resolveIslandScript("Package.swift")
	if err != nil {
		return "", err
	}
	return filepath.Dir(script), nil
}

func (s *Service) resolveIslandScript(rel string) (string, error) {
	rel = filepath.Clean(rel)
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	candidates := []string{}
	if root != "" {
		candidates = append(candidates,
			filepath.Join(root, "colleague-avatar", "macos", "AtollaIsland", rel),
			filepath.Join(root, "macos", "AtollaIsland", rel),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "macos", "AtollaIsland", rel),
			filepath.Join(wd, "..", "macos", "AtollaIsland", rel),
			filepath.Join(wd, "..", "..", "macos", "AtollaIsland", rel),
			filepath.Join(wd, "colleague-avatar", "macos", "AtollaIsland", rel),
		)
	}
	for _, p := range candidates {
		p = filepath.Clean(p)
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			continue
		}
		return p, nil
	}
	return "", fmt.Errorf("island path not found: %s", rel)
}

func (s *Service) islandSettingsCachePath() string {
	return filepath.Join(homeDir(), ".atolla", "island-settings-cache.json")
}

func (s *Service) loadIslandSettingsCache() (IslandSettingsStatus, bool) {
	raw, err := os.ReadFile(s.islandSettingsCachePath())
	if err != nil {
		return IslandSettingsStatus{}, false
	}
	var c islandSettingsCacheFile
	if err := json.Unmarshal(raw, &c); err != nil {
		return IslandSettingsStatus{}, false
	}
	if c.CheckedAt == "" {
		return IslandSettingsStatus{}, false
	}
	return c.IslandSettingsStatus, true
}

func (s *Service) saveIslandSettingsCache(st IslandSettingsStatus) error {
	path := s.islandSettingsCachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	st.Cached = true
	if st.CheckedAt == "" {
		st.CheckedAt = time.Now().Format(time.RFC3339)
	}
	raw, err := json.MarshalIndent(islandSettingsCacheFile{IslandSettingsStatus: st}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return os.TempDir()
}
