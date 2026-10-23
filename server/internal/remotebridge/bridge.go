package remotebridge

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"atolla/server/internal/permission"
	"atolla/server/internal/store"
)

const (
	heartbeatInterval = 7 * time.Second
	snapshotInterval  = 20 * time.Second
)

// Status exposes bridge health for admin APIs.
type Status struct {
	Running    bool       `json:"running"`
	LastOKAt   *time.Time `json:"last_ok,omitempty"`
	LastError  string     `json:"last_error,omitempty"`
	Registered bool       `json:"registered"`
}

// Bridge runs outbound register, heartbeat, long-poll, and periodic snapshots.
type Bridge struct {
	Config  *ConfigStore
	Store   *store.Store
	Runtime AgentRuntime
	Perms   *permission.Hub

	mu         sync.RWMutex
	status     Status
	generation uint64
	cancel     context.CancelFunc
	runWg      sync.WaitGroup
	reregister chan struct{}

	// Phone chat presence (viewer.set heartbeat); TTL checked in MobileViewingAgentID.
	mobileViewerAgentID int64
	mobileViewerAt      time.Time
}

// NewBridge constructs a bridge (does not start until Start).
func NewBridge(cs *ConfigStore, st *store.Store) *Bridge {
	return &Bridge{
		Config:     cs,
		Store:      st,
		reregister: make(chan struct{}, 1),
	}
}

// SetRuntime wires Ask/Stop implementation from the host Service.
func (b *Bridge) SetRuntime(rt AgentRuntime) {
	b.Runtime = rt
}

// StatusSnapshot returns current bridge status.
func (b *Bridge) StatusSnapshot() Status {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.status
}

func (b *Bridge) setOK() {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.status.LastOKAt = &now
	b.status.LastError = ""
}

func (b *Bridge) setErr(msg string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.status.LastError = msg
}

func (b *Bridge) setRunning(running, registered bool, gen uint64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if gen != b.generation {
		return
	}
	b.status.Running = running
	b.status.Registered = registered
}

func (b *Bridge) setRegistered(registered bool, gen uint64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if gen != b.generation {
		return
	}
	b.status.Registered = registered
}

// stopLoop cancels the active run loop and waits until it exits.
func (b *Bridge) stopLoop() {
	if b.cancel != nil {
		b.cancel()
		b.cancel = nil
	}
	b.runWg.Wait()
}

// Start 在配置就绪时启动出站循环，并立刻向中继注册一次。
func (b *Bridge) Start(parent context.Context) {
	b.start(parent, true)
}

// start 启动出站循环。register 为 false 时不调用注册接口，避免把中继的每分钟次数打满。
func (b *Bridge) start(parent context.Context, register bool) {
	if b.Config == nil || b.Store == nil {
		return
	}
	b.stopLoop()
	if !b.Config.Ready() {
		return
	}

	b.mu.Lock()
	b.generation++
	gen := b.generation
	keepRegistered := !register && b.status.Registered
	b.mu.Unlock()

	ctx, cancel := context.WithCancel(parent)
	b.cancel = cancel
	b.setRunning(true, keepRegistered, gen)

	b.runWg.Add(1)
	go func() {
		defer b.runWg.Done()
		b.run(ctx, gen, register)
	}()
}

// Stop cancels the bridge loop and waits for exit.
func (b *Bridge) Stop() {
	b.stopLoop()
}

// TriggerReregister signals the loop to re-register (e.g. after password rotate).
func (b *Bridge) TriggerReregister() {
	select {
	case b.reregister <- struct{}{}:
	default:
	}
}

// Reload 按最新配置重启出站循环，并重新注册。
func (b *Bridge) Reload(parent context.Context) {
	if b.Config.Ready() {
		b.start(parent, true)
	} else {
		b.Stop()
	}
}

// ReloadWithoutRegister 重启出站循环，但不向中继再注册一次。
func (b *Bridge) ReloadWithoutRegister(parent context.Context) {
	if b.Config.Ready() {
		b.start(parent, false)
		return
	}
	b.Stop()
}

// MarkReachable 清掉上次注册错误，并标记当前这轮循环已注册。
func (b *Bridge) MarkReachable() {
	b.setOK()
	b.mu.Lock()
	gen := b.generation
	b.mu.Unlock()
	b.setRegistered(true, gen)
}

func (b *Bridge) run(ctx context.Context, gen uint64, register bool) {
	defer b.setRunning(false, false, gen)

	cfg := b.Config.Get()
	client := b.newClient(cfg)
	actions := RegisteredActions()

	if register {
		if err := client.Register(ctx, cfg.DisplayName, actions, ""); err != nil {
			b.setErr(err.Error())
			log.Printf("remotebridge: register failed: %v", err)
		} else {
			b.setOK()
			b.setRunning(true, true, gen)
		}
	}

	heartbeatTicker := time.NewTicker(heartbeatInterval)
	snapshotTicker := time.NewTicker(snapshotInterval)
	defer heartbeatTicker.Stop()
	defer snapshotTicker.Stop()

	longPollDone := make(chan struct{})
	go b.longPollLoop(ctx, longPollDone)
	defer func() {
		<-longPollDone
	}()

	b.startPermissionSync(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-b.reregister:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			if err := client.Register(ctx, cfg.DisplayName, actions, ""); err != nil {
				b.setErr(err.Error())
				log.Printf("remotebridge: re-register failed: %v", err)
			} else {
				b.setOK()
				b.setRegistered(true, gen)
			}
		case <-heartbeatTicker.C:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			smtpOk := cfg.SmtpConfigured() && cfg.SmtpOk
			hb, err := client.Heartbeat(ctx, actions, smtpOk)
			if err != nil {
				if adopted, hb2, ok := b.adoptStagedPassword(ctx, cfg, actions, smtpOk, err); ok {
					cfg = adopted
					client = b.newClient(cfg)
					hb = hb2
					err = nil
				}
			} else if strings.TrimSpace(cfg.PendingPassword) != "" {
				// 当前密码仍被接受，说明待定密码没有写到中继上。
				_ = b.Config.ClearPendingPassword()
			}
			if err != nil {
				b.setErr(err.Error())
			} else {
				// Heartbeat auth success means the instance is registered on the relay.
				b.setOK()
				b.setRegistered(true, gen)
				// Sync phone viewing presence from relay DB (primary path for PC icon).
				if hb != nil {
					b.applyRelayMobileViewer(hb.MobileViewingAgentID)
				}
			}
		case <-snapshotTicker.C:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			ec := &ExecContext{Context: ctx, Store: b.Store, Client: client, Runtime: b.Runtime, Config: b.Config}
			if err := PushAgentsTasksSnapshots(ec); err != nil {
				b.setErr(err.Error())
			} else {
				b.setOK()
			}
		}
	}
}

// adoptStagedPassword 在当前密码被拒时，用注册前已落盘的待定密码再心跳一次。成功就把待定密码升成正式密码。
func (b *Bridge) adoptStagedPassword(ctx context.Context, cfg Config, actions []string, smtpOk bool, authErr error) (Config, *HeartbeatResult, bool) {
	if !IsUnauthorized(authErr) {
		return cfg, nil, false
	}
	pending := strings.TrimSpace(cfg.PendingPassword)
	if !ValidInstancePassword(pending) || pending == strings.TrimSpace(cfg.Password) {
		return cfg, nil, false
	}
	alt := cfg
	alt.Password = pending
	hb, err := b.newClient(alt).Heartbeat(ctx, actions, smtpOk)
	if err != nil {
		return cfg, nil, false
	}
	if err := b.Config.SetPassword(pending); err != nil {
		log.Printf("remotebridge: staged password accepted but not saved: %v", err)
		return alt, hb, true
	}
	return b.Config.Get(), hb, true
}

func (b *Bridge) newClient(cfg Config) *RelayClient {
	return &RelayClient{
		BaseURL:    cfg.BaseURL,
		InstanceID: cfg.InstanceID,
		Password:   cfg.Password,
	}
}

// PushAgentsSnapshotNow refreshes agents (+ tasks) mirror so phone drops deleted agents promptly.
func (b *Bridge) PushAgentsSnapshotNow() {
	if b == nil || b.Config == nil || b.Store == nil || !b.Config.Ready() {
		return
	}
	cfg := b.Config.Get()
	client := b.newClient(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ec := &ExecContext{Context: ctx, Store: b.Store, Client: client, Runtime: b.Runtime, Config: b.Config}
	if err := PushAgentsTasksSnapshots(ec); err != nil {
		log.Printf("remotebridge push agents after delete: %v", err)
		b.setErr(err.Error())
	} else {
		b.setOK()
	}
}

// PushAgentMessagesSnapshot pushes recent messages (+ agents/tasks) after a remote ask finishes.
func (b *Bridge) PushAgentMessagesSnapshot(agentID int64) {
	if b == nil || b.Config == nil || b.Store == nil || !b.Config.Ready() {
		return
	}
	cfg := b.Config.Get()
	client := b.newClient(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	ec := &ExecContext{
		Context: ctx,
		Store:   b.Store,
		Client:  client,
		Runtime: b.Runtime,
		Config:  b.Config,
		Payload: map[string]any{
			"agent_id": strconv.FormatInt(agentID, 10),
			"limit":    40,
		},
	}
	if _, err := handleSyncMessages(ec); err != nil {
		log.Printf("remotebridge push messages agent=%d: %v", agentID, err)
		b.setErr(err.Error())
	} else {
		b.setOK()
	}
	if err := PushAgentsTasksSnapshots(ec); err != nil {
		log.Printf("remotebridge push agents/tasks after ask agent=%d: %v", agentID, err)
		b.setErr(err.Error())
	} else {
		b.setOK()
	}
}

func (b *Bridge) longPollLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	for {
		if ctx.Err() != nil {
			return
		}
		cfg := b.Config.Get()
		client := b.newClient(cfg)
		cmds, err := client.LongPoll(ctx, defaultLongPollWaitMS)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			b.setErr(err.Error())
			time.Sleep(2 * time.Second)
			continue
		}
		b.setOK()
		for _, cmd := range cmds {
			b.handleCommand(ctx, client, cmd)
		}
	}
}

func (b *Bridge) handleCommand(ctx context.Context, client *RelayClient, cmd DeviceCommand) {
	h, ok := Handlers[cmd.Action]
	if !ok {
		_ = client.SubmitCommandResult(ctx, cmd.ID, "rejected", map[string]any{
			"reason": "action not registered on bridge",
		})
		return
	}
	ec := &ExecContext{
		Context: ctx,
		Store:   b.Store,
		Client:  client,
		Payload: cmd.Payload,
		Runtime: b.Runtime,
		Viewer:  b,
		Config:  b.Config,
	}
	body, err := h(ec)
	if err != nil {
		_ = client.SubmitCommandResult(ctx, cmd.ID, "error", map[string]any{"error": err.Error()})
		b.setErr(err.Error())
		return
	}
	_ = client.SubmitCommandResult(ctx, cmd.ID, "done", body)
	b.setOK()
}
