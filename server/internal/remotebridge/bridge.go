package remotebridge

import (
	"context"
	"log"
	"sync"
	"time"

	"atolla/server/internal/store"
)

const (
	heartbeatInterval = 7 * time.Second
	snapshotInterval  = 20 * time.Second
)

// Status exposes bridge health for admin APIs.
type Status struct {
	Running     bool       `json:"running"`
	LastOKAt    *time.Time `json:"last_ok_at,omitempty"`
	LastError   string     `json:"last_error,omitempty"`
	Registered  bool       `json:"registered"`
}

// Bridge runs outbound register, heartbeat, long-poll, and periodic snapshots.
type Bridge struct {
	Config *ConfigStore
	Store  *store.Store

	mu          sync.RWMutex
	status      Status
	cancel      context.CancelFunc
	reregister  chan struct{}
}

// NewBridge constructs a bridge (does not start until Start).
func NewBridge(cs *ConfigStore, st *store.Store) *Bridge {
	return &Bridge{
		Config:     cs,
		Store:      st,
		reregister: make(chan struct{}, 1),
	}
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

func (b *Bridge) setRunning(running, registered bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.status.Running = running
	b.status.Registered = registered
}

// Start launches the bridge loop when config is ready.
func (b *Bridge) Start(parent context.Context) {
	if b.Config == nil || b.Store == nil {
		return
	}
	b.Stop()
	if !b.Config.Ready() {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	b.cancel = cancel
	b.setRunning(true, false)
	go b.run(ctx)
}

// Stop cancels the bridge loop.
func (b *Bridge) Stop() {
	if b.cancel != nil {
		b.cancel()
		b.cancel = nil
	}
	b.setRunning(false, false)
}

// TriggerReregister signals the loop to re-register (e.g. after password rotate).
func (b *Bridge) TriggerReregister() {
	select {
	case b.reregister <- struct{}{}:
	default:
	}
}

// Reload applies latest config: restart if enabled, stop otherwise.
func (b *Bridge) Reload(parent context.Context) {
	if b.Config.Ready() {
		b.Start(parent)
	} else {
		b.Stop()
	}
}

func (b *Bridge) run(ctx context.Context) {
	defer b.setRunning(false, false)

	cfg := b.Config.Get()
	client := b.newClient(cfg)
	actions := RegisteredActions()

	if err := client.Register(ctx, cfg.DisplayName, actions); err != nil {
		b.setErr(err.Error())
		log.Printf("remotebridge: register failed: %v", err)
	} else {
		b.setOK()
		b.setRunning(true, true)
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

	for {
		select {
		case <-ctx.Done():
			return
		case <-b.reregister:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			if err := client.Register(ctx, cfg.DisplayName, actions); err != nil {
				b.setErr(err.Error())
				log.Printf("remotebridge: re-register failed: %v", err)
			} else {
				b.setOK()
				b.mu.Lock()
				b.status.Registered = true
				b.mu.Unlock()
			}
		case <-heartbeatTicker.C:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			if err := client.Heartbeat(ctx, actions); err != nil {
				b.setErr(err.Error())
			} else {
				b.setOK()
			}
		case <-snapshotTicker.C:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			ec := &ExecContext{Context: ctx, Store: b.Store, Client: client}
			if err := PushAgentsTasksSnapshots(ec); err != nil {
				b.setErr(err.Error())
			} else {
				b.setOK()
			}
		}
	}
}

func (b *Bridge) newClient(cfg Config) *RelayClient {
	return &RelayClient{
		BaseURL:    cfg.BaseURL,
		InstanceID: cfg.InstanceID,
		Password:   cfg.Password,
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
