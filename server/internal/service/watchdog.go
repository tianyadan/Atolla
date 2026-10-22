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

// WatchdogStatus 是设置页展示的守护状态（本机 / 中继各自独立）。
type WatchdogStatus struct {
	Enabled  bool   `json:"enabled"`
	Status   string `json:"status"` // active | inactive | error | unknown
	Detail   string `json:"detail"`
	GraceSec int    `json:"grace_sec"`
}

// RelayWatchdogTarget 中继守护 SSH 目标（不存密码）。
type RelayWatchdogTarget struct {
	Host       string `json:"host"`
	User       string `json:"user"`
	SSHPort    int    `json:"ssh_port"`
	RemoteDir  string `json:"remote_dir"`
	ListenPort int    `json:"listen_port"`
	// LastEnabled 上次成功开/关后的期望状态（无 SSH 密码刷新时作回退展示）
	LastEnabled bool `json:"last_enabled,omitempty"`
}

// RelayWatchdogPut 开启/关闭中继守护时的请求体。
type RelayWatchdogPut struct {
	Enabled     bool   `json:"enabled"`
	Host        string `json:"host"`
	User        string `json:"user"`
	SSHPort     int    `json:"ssh_port"`
	RemoteDir   string `json:"remote_dir"`
	ListenPort  int    `json:"listen_port"`
	SSHPassword string `json:"ssh_password"`
}

// LocalWatchdogPut 开启/关闭本机守护。
type LocalWatchdogPut struct {
	Enabled bool `json:"enabled"`
}

// GetLocalWatchdogStatus 探测本机 LaunchAgent 是否加载。
func (s *Service) GetLocalWatchdogStatus() (WatchdogStatus, error) {
	script, err := s.resolveWatchdogScript("scripts/watchdog/status-local.sh")
	if err != nil {
		return WatchdogStatus{Status: "error", Detail: err.Error(), GraceSec: 180}, err
	}
	return s.runWatchdogJSON(script, nil, "", 180)
}

// SetLocalWatchdog 安装或卸载本机守护。
func (s *Service) SetLocalWatchdog(enabled bool) (WatchdogStatus, error) {
	name := "scripts/watchdog/uninstall-local.sh"
	if enabled {
		name = "scripts/watchdog/install-local.sh"
	}
	script, err := s.resolveWatchdogScript(name)
	if err != nil {
		return WatchdogStatus{Status: "error", Detail: err.Error(), GraceSec: 180}, err
	}
	ctxOut, err := s.runWatchdogCmd(script, nil, "", 90*time.Second)
	if err != nil {
		return WatchdogStatus{Enabled: false, Status: "error", Detail: trimDetail(ctxOut, err), GraceSec: 180}, err
	}
	return s.GetLocalWatchdogStatus()
}

// GetRelayWatchdogStatus 探测远端 timer；无 host 时返回未配置。
func (s *Service) GetRelayWatchdogStatus() (WatchdogStatus, RelayWatchdogTarget, error) {
	target, _ := s.loadRelayWatchdogTarget()
	if strings.TrimSpace(target.Host) == "" {
		return WatchdogStatus{
			Enabled:  false,
			Status:   "unknown",
			Detail:   "尚未配置部署主机，开启时请填写 SSH 主机",
			GraceSec: 300,
		}, target, nil
	}
	script, err := s.resolveWatchdogScript("remote-relay/deploy/watchdog/status-relay.sh")
	if err != nil {
		return WatchdogStatus{Status: "error", Detail: err.Error(), GraceSec: 300}, target, err
	}
	st, err := s.runWatchdogJSON(script, relayArgs(target), "", 300)
	// 无密钥/密码时 SSH 探测失败：回退到上次成功操作状态，避免 UI 误显示关闭
	if err != nil || st.Status == "error" {
		if target.LastEnabled {
			return WatchdogStatus{
				Enabled:  true,
				Status:   "active",
				Detail:   "远端上次已启用；本次未带 SSH 密码无法实时探测。需要核对时请填写密码后重新打开开关。",
				GraceSec: 300,
			}, target, nil
		}
	}
	return st, target, err
}

// SetRelayWatchdog 安装或卸载远端中继守护，并持久化主机信息。
func (s *Service) SetRelayWatchdog(req RelayWatchdogPut) (WatchdogStatus, RelayWatchdogTarget, error) {
	target := RelayWatchdogTarget{
		Host:       strings.TrimSpace(req.Host),
		User:       strings.TrimSpace(req.User),
		SSHPort:    req.SSHPort,
		RemoteDir:  strings.TrimSpace(req.RemoteDir),
		ListenPort: req.ListenPort,
	}
	if saved, ok := s.loadRelayWatchdogTarget(); ok && target.Host == "" {
		target = saved
	}
	if target.Host == "" {
		return WatchdogStatus{Status: "error", Detail: "host required", GraceSec: 300}, target, fmt.Errorf("host required")
	}
	if target.User == "" {
		target.User = "root"
	}
	if target.SSHPort <= 0 {
		target.SSHPort = 22
	}
	if target.RemoteDir == "" {
		target.RemoteDir = "/opt/atolla-remote-relay"
	}
	if target.ListenPort <= 0 {
		target.ListenPort = 3080
	}
	_ = s.saveRelayWatchdogTarget(target)

	name := "remote-relay/deploy/watchdog/uninstall-relay.sh"
	if req.Enabled {
		name = "remote-relay/deploy/watchdog/install-relay.sh"
	}
	script, err := s.resolveWatchdogScript(name)
	if err != nil {
		return WatchdogStatus{Status: "error", Detail: err.Error(), GraceSec: 300}, target, err
	}
	pw := normalizeSSHPassword(req.SSHPassword)
	if pw == "" {
		return WatchdogStatus{
			Enabled:  false,
			Status:   "error",
			Detail:   "请填写 SSH 密码后再开启/关闭移动端中继守护（密码不落盘，仅本次使用）",
			GraceSec: 300,
		}, target, fmt.Errorf("ssh_password required")
	}
	st, err := s.runWatchdogJSONTimeout(script, relayArgs(target), pw, 300, 3*time.Minute)
	if err != nil {
		_ = s.saveRelayWatchdogTarget(target)
		return st, target, err
	}
	// 安装/卸载成功后，用同一密码再探一次真实 timer 状态（避免无密钥时误报）
	if statusScript, serr := s.resolveWatchdogScript("remote-relay/deploy/watchdog/status-relay.sh"); serr == nil {
		if live, lerr := s.runWatchdogJSONTimeout(statusScript, relayArgs(target), pw, 300, 90*time.Second); lerr == nil {
			st = live
		}
	}
	target.LastEnabled = st.Enabled || (req.Enabled && st.Status != "error")
	if req.Enabled && st.Status == "active" {
		target.LastEnabled = true
	}
	if !req.Enabled && (st.Status == "inactive" || !st.Enabled) {
		target.LastEnabled = false
	}
	_ = s.saveRelayWatchdogTarget(target)
	return st, target, nil
}

func relayArgs(t RelayWatchdogTarget) []string {
	return []string{
		"--host", t.Host,
		"--user", t.User,
		"--ssh-port", fmt.Sprintf("%d", t.SSHPort),
		"--remote-dir", t.RemoteDir,
		"--listen-port", fmt.Sprintf("%d", t.ListenPort),
	}
}

func (s *Service) runWatchdogJSON(script string, args []string, sshPassword string, grace int) (WatchdogStatus, error) {
	return s.runWatchdogJSONTimeout(script, args, sshPassword, grace, 90*time.Second)
}

func (s *Service) runWatchdogJSONTimeout(script string, args []string, sshPassword string, grace int, timeout time.Duration) (WatchdogStatus, error) {
	out, err := s.runWatchdogCmd(script, args, sshPassword, timeout)
	st := WatchdogStatus{GraceSec: grace, Status: "unknown", Detail: strings.TrimSpace(out)}
	if err != nil {
		st.Status = "error"
		st.Detail = clipWatchdogDetail(trimDetail(out, err))
		return st, fmt.Errorf("%s", st.Detail)
	}
	line := lastJSONLine(out)
	if uerr := json.Unmarshal([]byte(line), &st); uerr != nil {
		st.Status = "error"
		st.Detail = clipWatchdogDetail("无法解析状态: " + strings.TrimSpace(out))
		return st, fmt.Errorf("%s", st.Detail)
	}
	if st.GraceSec <= 0 {
		st.GraceSec = grace
	}
	// 脚本 exit 0 但 JSON 标 error 时，把前面的日志也拼进 detail，便于 UI 展示
	if st.Status == "error" || strings.Contains(strings.ToLower(st.Detail), "ssh") {
		st.Detail = clipWatchdogDetail(mergeWatchdogLogs(out, st.Detail))
	}
	return st, nil
}

/** 截断过长日志，保留尾部（错误通常在末尾） */
func clipWatchdogDetail(s string) string {
	s = strings.TrimSpace(s)
	const max = 1800
	if len(s) <= max {
		return s
	}
	return "…\n" + s[len(s)-max:]
}

/** 把脚本 stdout/stderr 与 JSON detail 合并 */
func mergeWatchdogLogs(out, detail string) string {
	out = strings.TrimSpace(out)
	detail = strings.TrimSpace(detail)
	if out == "" {
		return detail
	}
	if detail == "" {
		return out
	}
	if strings.Contains(out, detail) {
		return out
	}
	return out + "\n---\n" + detail
}

func (s *Service) runWatchdogCmd(script string, args []string, sshPassword string, timeout time.Duration) (string, error) {
	if script == "" {
		return "", fmt.Errorf("empty watchdog script path")
	}
	if err := os.Chmod(script, 0o755); err != nil {
		// 非致命：可能只读挂载
		_ = err
	}
	ctxTimeout := timeout
	if ctxTimeout <= 0 {
		ctxTimeout = 60 * time.Second
	}
	cmd := exec.Command(script, args...)
	cmd.Dir = filepath.Dir(script)
	// 尽量以仓库根为 cwd（scripts 在 scripts/watchdog，relay 在 remote-relay/deploy/watchdog）
	if repo, err := s.resolveColleagueAvatarRoot(); err == nil {
		cmd.Dir = repo
	}
	path := os.Getenv("PATH")
	path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + path
	env := append(os.Environ(),
		"PATH="+path,
		"ATOLLA_DEPLOY_NONINTERACTIVE=1",
		"GIT_TERMINAL_PROMPT=0",
	)
	if sshPassword != "" {
		env = append(env, "ATOLLA_SSH_PASSWORD="+sshPassword)
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
	case <-time.After(ctxTimeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return buf.String(), fmt.Errorf("watchdog command timeout")
	}
}

func lastJSONLine(out string) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "{") {
			return line
		}
	}
	return strings.TrimSpace(out)
}

func trimDetail(out string, err error) string {
	msg := strings.TrimSpace(out)
	if msg == "" && err != nil {
		return err.Error()
	}
	if err != nil && msg != "" {
		return msg + " (" + err.Error() + ")"
	}
	return msg
}

func (s *Service) resolveColleagueAvatarRoot() (string, error) {
	script, err := s.resolveWatchdogScript("scripts/watchdog/local-check.sh")
	if err != nil {
		return "", err
	}
	// .../colleague-avatar/scripts/watchdog/local-check.sh → colleague-avatar
	return filepath.Clean(filepath.Join(filepath.Dir(script), "..", "..")), nil
}

func (s *Service) resolveWatchdogScript(rel string) (string, error) {
	rel = filepath.Clean(rel)
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	candidates := []string{}
	if root != "" {
		candidates = append(candidates,
			filepath.Join(root, "colleague-avatar", rel),
			filepath.Join(root, rel),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, rel),
			filepath.Join(wd, "..", rel),
			filepath.Join(wd, "..", "..", rel),
			filepath.Join(wd, "colleague-avatar", rel),
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
	return "", fmt.Errorf("watchdog script not found: %s", rel)
}

func (s *Service) relayWatchdogConfigPath() string {
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	if root == "" {
		root = os.TempDir()
	}
	return filepath.Join(root, ".atolla", "relay-watchdog.json")
}

func (s *Service) loadRelayWatchdogTarget() (RelayWatchdogTarget, bool) {
	path := s.relayWatchdogConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return RelayWatchdogTarget{}, false
	}
	var t RelayWatchdogTarget
	if err := json.Unmarshal(data, &t); err != nil {
		return RelayWatchdogTarget{}, false
	}
	if strings.TrimSpace(t.Host) == "" {
		return t, false
	}
	return t, true
}

func (s *Service) saveRelayWatchdogTarget(t RelayWatchdogTarget) error {
	path := s.relayWatchdogConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
