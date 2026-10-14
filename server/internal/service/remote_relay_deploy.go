package service

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RemoteRelayDeployRequest is the body for one-click install.
type RemoteRelayDeployRequest struct {
	Host         string `json:"host"`
	User         string `json:"user"`
	SSHPort      int    `json:"ssh_port"`
	RemoteDir    string `json:"remote_dir"`
	ListenPort   int    `json:"listen_port"`
	SitePassword string `json:"site_password"`
	SSHPassword  string `json:"ssh_password"` // cloud SSH password; not persisted
	ChinaMirror  bool   `json:"china_mirror"`
}

// RemoteRelayUpgradeRequest is the body for one-click upgrade.
type RemoteRelayUpgradeRequest struct {
	Host        string `json:"host"`
	User        string `json:"user"`
	SSHPort     int    `json:"ssh_port"`
	RemoteDir   string `json:"remote_dir"`
	SSHPassword string `json:"ssh_password"` // cloud SSH password; not persisted
	ChinaMirror bool   `json:"china_mirror"`
}

// DeployJobPublic is safe status for the UI.
type DeployJobPublic struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"` // deploy | upgrade
	Done  bool   `json:"done"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Lines int    `json:"lines"`
}

type deployJob struct {
	id   string
	kind string

	mu     sync.Mutex
	lines  []string
	done   bool
	ok     bool
	errMsg string
	subs   map[chan string]struct{}
}

func newDeployJobID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%d-%s", time.Now().Unix(), hex.EncodeToString(b[:]))
}

func newDeployJob(kind string) *deployJob {
	return &deployJob{
		id:   newDeployJobID(),
		kind: kind,
		subs: map[chan string]struct{}{},
	}
}

func (j *deployJob) appendLine(line string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.lines = append(j.lines, line)
	for ch := range j.subs {
		select {
		case ch <- line:
		default:
		}
	}
}

func (j *deployJob) finish(ok bool, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done = true
	j.ok = ok
	j.errMsg = errMsg
	for ch := range j.subs {
		close(ch)
	}
	j.subs = map[chan string]struct{}{}
}

func (j *deployJob) snapshot() (lines []string, done, ok bool, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	lines = append([]string(nil), j.lines...)
	return lines, j.done, j.ok, j.errMsg
}

func (j *deployJob) subscribe() (lines []string, ch chan string, done, ok bool, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	lines = append([]string(nil), j.lines...)
	if j.done {
		return lines, nil, true, j.ok, j.errMsg
	}
	ch = make(chan string, 64)
	j.subs[ch] = struct{}{}
	return lines, ch, false, false, ""
}

func (j *deployJob) unsubscribe(ch chan string) {
	if ch == nil {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.subs, ch)
}

// deployJobHub keeps at most one running deploy/upgrade.
type deployJobHub struct {
	mu      sync.Mutex
	current *deployJob
	byID    map[string]*deployJob
}

func (s *Service) deployHub() *deployJobHub {
	s.deployJobOnce.Do(func() {
		s.deployJobs = &deployJobHub{byID: map[string]*deployJob{}}
	})
	return s.deployJobs
}

// StartRemoteRelayDeploy runs install.sh asynchronously; optional ssh_password or key BatchMode.
func (s *Service) StartRemoteRelayDeploy(req RemoteRelayDeployRequest) (string, error) {
	host := strings.TrimSpace(req.Host)
	if host == "" {
		return "", fmt.Errorf("host required")
	}
	pass := strings.TrimSpace(req.SitePassword)
	if pass == "" {
		return "", fmt.Errorf("site_password required")
	}
	user := strings.TrimSpace(req.User)
	if user == "" {
		user = "root"
	}
	sshPort := req.SSHPort
	if sshPort <= 0 {
		sshPort = 22
	}
	remoteDir := strings.TrimSpace(req.RemoteDir)
	if remoteDir == "" {
		remoteDir = "/opt/atolla-remote-relay"
	}
	listenPort := req.ListenPort
	if listenPort <= 0 {
		listenPort = 3080
	}

	script, repoRoot, err := s.resolveRemoteRelayDeployScript("install.sh")
	if err != nil {
		return "", err
	}

	args := []string{
		"--host", host,
		"--user", user,
		"--ssh-port", fmt.Sprintf("%d", sshPort),
		"--remote-dir", remoteDir,
		"--port", fmt.Sprintf("%d", listenPort),
		"--site-password", pass,
	}
	if req.ChinaMirror {
		args = append(args, "--china-mirror")
	}
	return s.startDeployJob("deploy", script, repoRoot, args, normalizeSSHPassword(req.SSHPassword))
}

// StartRemoteRelayUpgrade runs upgrade.sh asynchronously.
func (s *Service) StartRemoteRelayUpgrade(req RemoteRelayUpgradeRequest) (string, error) {
	host := strings.TrimSpace(req.Host)
	if host == "" {
		return "", fmt.Errorf("host required")
	}
	user := strings.TrimSpace(req.User)
	if user == "" {
		user = "root"
	}
	sshPort := req.SSHPort
	if sshPort <= 0 {
		sshPort = 22
	}
	remoteDir := strings.TrimSpace(req.RemoteDir)
	if remoteDir == "" {
		remoteDir = "/opt/atolla-remote-relay"
	}

	script, repoRoot, err := s.resolveRemoteRelayDeployScript("upgrade.sh")
	if err != nil {
		return "", err
	}

	args := []string{
		"--host", host,
		"--user", user,
		"--ssh-port", fmt.Sprintf("%d", sshPort),
		"--remote-dir", remoteDir,
	}
	if req.ChinaMirror {
		args = append(args, "--china-mirror")
	}
	return s.startDeployJob("upgrade", script, repoRoot, args, normalizeSSHPassword(req.SSHPassword))
}

// normalizeSSHPassword trims spaces and strips CR from pasted passwords.
func normalizeSSHPassword(s string) string {
	s = strings.TrimSpace(s)
	return strings.ReplaceAll(s, "\r", "")
}

func (s *Service) startDeployJob(kind, script, repoRoot string, args []string, sshPassword string) (string, error) {
	hub := s.deployHub()
	hub.mu.Lock()
	if hub.current != nil {
		lines, done, _, _ := hub.current.snapshot()
		_ = lines
		if !done {
			hub.mu.Unlock()
			return "", fmt.Errorf("another deploy/upgrade job is running")
		}
	}
	job := newDeployJob(kind)
	hub.current = job
	hub.byID[job.id] = job
	hub.mu.Unlock()

	go s.runDeployJob(job, script, repoRoot, args, sshPassword)
	return job.id, nil
}

func (s *Service) runDeployJob(job *deployJob, script, repoRoot string, args []string, sshPassword string) {
	job.appendLine(fmt.Sprintf("==> starting %s: %s", job.kind, filepath.Base(script)))
	job.appendLine(fmt.Sprintf("repo: %s", repoRoot))
	if sshPassword != "" {
		job.appendLine("SSH: password provided (non-interactive)")
	} else {
		job.appendLine("SSH: key-only BatchMode (no password provided)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, script, args...)
	cmd.Dir = repoRoot
	env := append(os.Environ(),
		"ATOLLA_DEPLOY_NONINTERACTIVE=1",
		"GIT_TERMINAL_PROMPT=0",
	)
	if sshPassword != "" {
		env = append(env, "ATOLLA_SSH_PASSWORD="+sshPassword)
	}
	cmd.Env = env

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		job.finish(false, err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		job.finish(false, err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		job.finish(false, err.Error())
		return
	}

	var wg sync.WaitGroup
	pump := func(r io.Reader, prefix string) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		buf := make([]byte, 0, 64*1024)
		sc.Buffer(buf, 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if prefix != "" {
				job.appendLine(prefix + line)
			} else {
				job.appendLine(line)
			}
		}
	}
	wg.Add(2)
	go pump(stdout, "")
	go pump(stderr, "")
	wg.Wait()

	err = cmd.Wait()
	if ctx.Err() != nil {
		job.appendLine("error: timed out")
		job.finish(false, "timed out")
		return
	}
	if err != nil {
		job.appendLine("error: " + err.Error())
		job.finish(false, err.Error())
		return
	}
	job.appendLine("==> finished OK")
	job.finish(true, "")
}

// GetRemoteRelayDeployJob returns job status.
func (s *Service) GetRemoteRelayDeployJob(id string) (DeployJobPublic, error) {
	hub := s.deployHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job == nil {
		return DeployJobPublic{}, fmt.Errorf("job not found")
	}
	lines, done, ok, errMsg := job.snapshot()
	return DeployJobPublic{
		ID: job.id, Kind: job.kind, Done: done, OK: ok, Error: errMsg, Lines: len(lines),
	}, nil
}

// SubscribeRemoteRelayDeployJob returns buffered lines and a live channel (nil if already done).
func (s *Service) SubscribeRemoteRelayDeployJob(id string) (lines []string, ch chan string, done, ok bool, errMsg string, err error) {
	hub := s.deployHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job == nil {
		return nil, nil, false, false, "", fmt.Errorf("job not found")
	}
	lines, ch, done, ok, errMsg = job.subscribe()
	return lines, ch, done, ok, errMsg, nil
}

// UnsubscribeRemoteRelayDeployJob drops a live log subscriber.
func (s *Service) UnsubscribeRemoteRelayDeployJob(id string, ch chan string) {
	if ch == nil {
		return
	}
	hub := s.deployHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job != nil {
		job.unsubscribe(ch)
	}
}

// SnapshotRemoteRelayDeployJob returns current terminal state.
func (s *Service) SnapshotRemoteRelayDeployJob(id string) (done, ok bool, errMsg string, err error) {
	hub := s.deployHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job == nil {
		return false, false, "", fmt.Errorf("job not found")
	}
	_, done, ok, errMsg = job.snapshot()
	return done, ok, errMsg, nil
}

func (s *Service) resolveRemoteRelayDeployScript(name string) (scriptPath, repoRoot string, err error) {
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	candidates := []string{}
	if root != "" {
		candidates = append(candidates,
			filepath.Join(root, "remote-relay", "deploy", name),
			filepath.Join(root, "colleague-avatar", "remote-relay", "deploy", name),
		)
	}
	// Also try next to this source tree when running from repo (dev).
	if wd, werr := os.Getwd(); werr == nil {
		candidates = append(candidates,
			filepath.Join(wd, "remote-relay", "deploy", name),
			filepath.Join(wd, "..", "remote-relay", "deploy", name),
			filepath.Join(wd, "..", "..", "remote-relay", "deploy", name),
		)
	}
	for _, p := range candidates {
		p = filepath.Clean(p)
		st, serr := os.Stat(p)
		if serr != nil || st.IsDir() {
			continue
		}
		repo := filepath.Clean(filepath.Join(filepath.Dir(p), "..", ".."))
		return p, repo, nil
	}
	return "", "", fmt.Errorf("deploy script %s not found under workspace (tried remote-relay/deploy/)", name)
}
