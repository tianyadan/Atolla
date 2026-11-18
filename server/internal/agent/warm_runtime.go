package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// WarmRuntime 按会话保留 Claude stream-json 进程。正在执行的进程不会因空闲回收或内存压力被终止。
type WarmRuntime struct {
	bin           string
	ttl           time.Duration
	memoryLimitKB int64

	mu      sync.Mutex
	workers map[int64]*warmWorker
	closed  bool
	stop    chan struct{}
	rss     func(int) int64
	stopOne func(*warmWorker)
}

type warmWorker struct {
	convID int64
	model  string // 启动时 --model；切换模型时重建进程
	cmd    *exec.Cmd
	stdin  interface {
		Write([]byte) (int, error)
		Close() error
	}
	lines chan []byte
	done  chan error

	callMu   sync.Mutex
	users    int
	lastUsed time.Time
	pgid     int
}

// NewWarmRuntime 创建保温池并启动轻量回收器。
func NewWarmRuntime(bin string, ttl time.Duration, memoryLimitMB int) *WarmRuntime {
	if memoryLimitMB < 128 {
		memoryLimitMB = 2048
	}
	r := &WarmRuntime{
		bin:           bin,
		ttl:           ttl,
		memoryLimitKB: int64(memoryLimitMB) * 1024,
		workers:       map[int64]*warmWorker{},
		stop:          make(chan struct{}),
		rss:           processGroupRSSKB,
		stopOne:       stopWarmWorker,
	}
	go r.reapLoop()
	return r
}

// Close 只释放空闲/运行中的保温子进程；由服务退出流程调用。
func (r *WarmRuntime) Close() {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	close(r.stop)
	workers := make([]*warmWorker, 0, len(r.workers))
	for _, w := range r.workers {
		workers = append(workers, w)
	}
	r.workers = map[int64]*warmWorker{}
	r.mu.Unlock()
	for _, w := range workers {
		r.stopOne(w)
	}
}

// Ask 在同一 conversation 内串行投递消息，result 后保留进程供下一轮直接复用。
// model 变更时丢弃旧保温进程并重建。
func (r *WarmRuntime) Ask(ctx context.Context, dir, systemPrompt, question, history string, onChunk func(string), timeout time.Duration, hook HookSpec, onActivity ActivityFn, onMeta MetaFn, onPhase PhaseFn, resumeSession string, images []ImagePart, model string) (string, int, error) {
	start := time.Now()
	w, err := r.worker(hook.ConvID, dir, systemPrompt, hook, resumeSession, model)
	if err != nil {
		return "", 0, err
	}
	w.callMu.Lock()
	defer w.callMu.Unlock()

	defer r.release(w)

	userInput := history
	if userInput != "" {
		userInput += "\n\n"
	}
	userInput += question
	msg := map[string]interface{}{
		"type":    "user",
		"message": map[string]interface{}{"role": "user", "content": BuildUserContent(userInput, images)},
	}
	payload, _ := json.Marshal(msg)
	payload = append(payload, '\n')
	if _, err := w.stdin.Write(payload); err != nil {
		r.discard(w)
		return "", int(time.Since(start).Milliseconds()), err
	}

	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var full strings.Builder
	lastAct := ""
	var lastMeta RunMeta
	for {
		select {
		case <-cctx.Done():
			r.discard(w)
			return full.String(), int(time.Since(start).Milliseconds()), cctx.Err()
		case runErr := <-w.done:
			r.discard(w)
			if runErr == nil {
				runErr = fmt.Errorf("claude process exited before result")
			}
			return full.String(), int(time.Since(start).Milliseconds()), runErr
		case line := <-w.lines:
			linePhase := AgentPhase("")
			if phase, ok := ParseClaudePhase(line); ok {
				linePhase = phase.Phase
				if onPhase != nil {
					onPhase(phase)
				}
			}
			if meta, ok := ParseClaudeStreamMeta(line); ok {
				if meta.SessionID != "" {
					lastMeta.SessionID = StickySessionID(lastMeta.SessionID, meta.SessionID)
				}
				if meta.InputTokens > 0 || meta.OutputTokens > 0 || meta.CacheRead > 0 || meta.CacheWrite > 0 {
					lastMeta.InputTokens, lastMeta.OutputTokens = meta.InputTokens, meta.OutputTokens
					lastMeta.CacheRead, lastMeta.CacheWrite = meta.CacheRead, meta.CacheWrite
					lastMeta.UsedTokens = meta.UsedTokens
				}
				if meta.ContextWindow > 0 {
					lastMeta.ContextWindow = meta.ContextWindow
				}
				if onMeta != nil {
					onMeta(lastMeta)
				}
			}
			if onActivity != nil {
				if act, ok := ParseStreamActivity(line); ok {
					key := act.Tool + "|" + act.Summary
					if key != lastAct {
						lastAct = key
						onActivity(act)
					}
				}
			}
			text, snapshot, isResult := claudeLineText(line)
			if text != "" && strings.TrimSpace(text) != "No response requested." {
				if linePhase == PhaseThinking {
					// 思考增量只用于前端折叠展示，不进入本轮正文
					if onChunk != nil {
						onChunk(text)
					}
				} else if !snapshot || full.Len() == 0 {
					full.WriteString(text)
					if onChunk != nil {
						onChunk(text)
					}
				}
			}
			if isResult {
				if onMeta != nil && (lastMeta.SessionID != "" || lastMeta.InputTokens > 0) {
					onMeta(lastMeta)
				}
				return full.String(), int(time.Since(start).Milliseconds()), nil
			}
		}
	}
}

func (r *WarmRuntime) worker(convID int64, dir, systemPrompt string, hook HookSpec, resumeSession, model string) (*warmWorker, error) {
	model = strings.TrimSpace(model)
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil, fmt.Errorf("warm runtime closed")
	}
	if w := r.workers[convID]; w != nil {
		if w.model == model {
			w.users++
			r.mu.Unlock()
			return w, nil
		}
		// 模型切换：停掉旧进程再重建
		delete(r.workers, convID)
		r.mu.Unlock()
		r.stopOne(w)
		r.mu.Lock()
		if r.closed {
			r.mu.Unlock()
			return nil, fmt.Errorf("warm runtime closed")
		}
	}
	r.mu.Unlock()

	args := []string{"-p", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json", "--include-partial-messages", "--permission-mode", "default"}
	if rs := strings.TrimSpace(resumeSession); rs != "" {
		args = append(args, "--resume", rs)
	}
	if model != "" {
		args = append(args, "--model", model)
	}
	if st := hook.Settings(); st != "" {
		args = append(args, "--settings", st)
	}
	if systemPrompt != "" {
		args = append(args, "--append-system-prompt", systemPrompt)
	}
	// 使用独立生命周期的 CommandContext；请求 ctx 结束只在明确取消时由 discard 释放进程。
	cmd := exec.CommandContext(context.Background(), r.bin, args...)
	AttachKillable(cmd)
	cmd.Dir = dir
	cmd.Env = CLIChildEnv(CleanEnv(os.Environ()), "claude")
	cmd.Env = append(cmd.Env, hook.Environ()...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	pgid, _ := syscall.Getpgid(cmd.Process.Pid)
	w := &warmWorker{convID: convID, model: model, cmd: cmd, stdin: stdin, lines: make(chan []byte, 128), done: make(chan error, 1), users: 1, lastUsed: time.Now(), pgid: pgid}
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := append([]byte(nil), sc.Bytes()...)
			w.lines <- line
		}
		w.done <- cmd.Wait()
	}()

	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		r.stopOne(w)
		return nil, fmt.Errorf("warm runtime closed")
	}
	if existing := r.workers[convID]; existing != nil {
		existing.users++
		r.mu.Unlock()
		r.stopOne(w)
		return existing, nil
	}
	r.workers[convID] = w
	r.mu.Unlock()
	return w, nil
}

func (r *WarmRuntime) release(w *warmWorker) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.workers[w.convID] == w {
		if w.users > 0 {
			w.users--
		}
		w.lastUsed = time.Now()
	}
}

func (r *WarmRuntime) discard(w *warmWorker) {
	r.mu.Lock()
	if r.workers[w.convID] == w {
		delete(r.workers, w.convID)
	}
	r.mu.Unlock()
	stopWarmWorker(w)
}

func (r *WarmRuntime) reapLoop() {
	interval := r.ttl / 2
	if interval < time.Second {
		interval = time.Second
	}
	if interval > 15*time.Second {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			r.reap()
		}
	}
}

func (r *WarmRuntime) reap() {
	now := time.Now()
	r.mu.Lock()
	idle := make([]*warmWorker, 0, len(r.workers))
	var totalKB int64
	for _, w := range r.workers {
		if w.users > 0 {
			continue
		}
		idle = append(idle, w)
		totalKB += r.rss(w.pgid)
	}
	pressure := r.memoryLimitKB > 0 && totalKB >= r.memoryLimitKB
	toStop := make([]*warmWorker, 0, len(idle))
	for _, w := range idle {
		if pressure || now.Sub(w.lastUsed) >= r.ttl {
			delete(r.workers, w.convID)
			toStop = append(toStop, w)
		}
	}
	r.mu.Unlock()
	for _, w := range toStop {
		r.stopOne(w)
	}
}

func stopWarmWorker(w *warmWorker) {
	if w == nil {
		return
	}
	_ = w.stdin.Close()
	if w.cmd != nil && w.cmd.Process != nil {
		_ = syscall.Kill(-w.cmd.Process.Pid, syscall.SIGTERM)
	}
}

// processGroupRSSKB 汇总进程组 RSS；失败时返回 0，不影响正常任务。
func processGroupRSSKB(pgid int) int64 {
	if pgid <= 0 {
		return 0
	}
	out, err := exec.Command("ps", "-axo", "pgid=,rss=").Output()
	if err != nil {
		return 0
	}
	var total int64
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		group, _ := strconv.Atoi(fields[0])
		if group != pgid {
			continue
		}
		rss, _ := strconv.ParseInt(fields[1], 10, 64)
		total += rss
	}
	return total
}

// CLIChildEnv 明确关闭各 CLI 的自动更新；Atolla 只允许人工安装锁定版本。
func CLIChildEnv(base []string, engine string) []string {
	env := append([]string(nil), base...)
	env = append(env, "NO_UPDATE_NOTIFIER=1")
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "claude":
		env = append(env, "DISABLE_AUTOUPDATER=1", "DISABLE_UPDATES=1")
	case "cursor", "agent":
		env = append(env, "CURSOR_AGENT_DISABLE_UPDATE=1")
	}
	return env
}
