package remotebridge

import (
	"context"
	"log"
	"strconv"
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

// Start launches the bridge loop when config is ready.
func (b *Bridge) Start(parent context.Context) {
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
	b.mu.Unlock()

	ctx, cancel := context.WithCancel(parent)
	b.cancel = cancel
	b.setRunning(true, false, gen)

	b.runWg.Add(1)
	go func() {
		defer b.runWg.Done()
		b.run(ctx, gen)
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

// Reload applies latest config: restart if enabled, stop otherwise.
func (b *Bridge) Reload(parent context.Context) {
	if b.Config.Ready() {
		b.Start(parent)
	} else {
		b.Stop()
	}
}

func (b *Bridge) run(ctx context.Context, gen uint64) {
	defer b.setRunning(false, false, gen)

	cfg := b.Config.Get()
	client := b.newClient(cfg)
	actions := RegisteredActions()

	if err := client.Register(ctx, cfg.DisplayName, actions, ""); err != nil {
		b.setErr(err.Error())
		log.Printf("remotebridge: register failed: %v", err)
	} else {
		b.setOK()
		b.setRunning(true, true, gen)
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
			if err := client.Heartbeat(ctx, actions); err != nil {
				b.setErr(err.Error())
			} else {
				// Heartbeat auth success means the instance is registered on the relay.
				b.setOK()
				b.setRegistered(true, gen)
			}
		case <-snapshotTicker.C:
			cfg = b.Config.Get()
			client = b.newClient(cfg)
			ec := &ExecContext{Context: ctx, Store: b.Store, Client: client, Runtime: b.Runtime}
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
