package service

import (
	"context"
	"fmt"
	"log"
	"strings"

	"atolla/server/internal/remotebridge"
)

// RemoteRelayPublicConfig is admin-safe remote relay settings.
type RemoteRelayPublicConfig = remotebridge.PublicConfig

// RemoteRelayStatus is bridge runtime status.
type RemoteRelayStatus = remotebridge.Status

// RemoteRelayConfigUpdate is PUT body for remote relay settings.
type RemoteRelayConfigUpdate struct {
	Enabled     bool   `json:"enabled"`
	BaseURL     string `json:"base_url"`
	InstanceID  string `json:"instance_id"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password,omitempty"`
}

// startRemoteBridge loads config and runs the outbound loop under a service-scoped context.
func (s *Service) startRemoteBridge(workspaceRoot string) {
	cs, err := remotebridge.NewConfigStore(workspaceRoot)
	if err != nil {
		log.Printf("remotebridge config: %v", err)
		return
	}
	if s.remoteBridgeParent == nil {
		s.remoteBridgeParent, s.remoteBridgeCancel = context.WithCancel(context.Background())
	}
	s.RemoteBridge = remotebridge.NewBridge(cs, s.Store)
	s.RemoteBridge.SetRuntime(s)
	s.RemoteBridge.SetPerms(s.Perms)
	s.RemoteBridge.Start(s.remoteBridgeParent)
}

// remoteBridgeContext returns the long-lived parent for bridge Start/Reload (not HTTP request ctx).
func (s *Service) remoteBridgeContext() context.Context {
	if s.remoteBridgeParent != nil {
		return s.remoteBridgeParent
	}
	return context.Background()
}

// StopRemoteBridge cancels the service bridge context and stops the loop.
func (s *Service) StopRemoteBridge() {
	if s.remoteBridgeCancel != nil {
		s.remoteBridgeCancel()
		s.remoteBridgeCancel = nil
	}
	if s.RemoteBridge != nil {
		s.RemoteBridge.Stop()
	}
}

// Shutdown stops background workers tied to process lifetime (remote bridge, etc.).
func (s *Service) Shutdown() {
	s.remoteBridgeShutdown.Do(func() {
		s.StopRemoteBridge()
	})
}

// GetRemoteRelayConfig returns persisted settings without password plaintext.
func (s *Service) GetRemoteRelayConfig() RemoteRelayPublicConfig {
	if s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return remotebridge.PublicConfig{}
	}
	return s.RemoteBridge.Config.Public()
}

// UpdateRemoteRelayConfig saves settings and reloads the bridge loop.
func (s *Service) UpdateRemoteRelayConfig(ctx context.Context, patch RemoteRelayConfigUpdate) (RemoteRelayPublicConfig, error) {
	if s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return remotebridge.PublicConfig{}, fmt.Errorf("remote bridge not initialized")
	}
	_, err := s.RemoteBridge.Config.Update(remotebridge.Config{
		Enabled:     patch.Enabled,
		BaseURL:     patch.BaseURL,
		InstanceID:  patch.InstanceID,
		DisplayName: patch.DisplayName,
		Password:    patch.Password,
	})
	if err != nil {
		return remotebridge.PublicConfig{}, err
	}
	// 保存连接配置只重载出站循环，不再次注册，避免把中继每分钟 5 次的限额打满。
	s.RemoteBridge.ReloadWithoutRegister(s.remoteBridgeContext())
	return s.RemoteBridge.Config.Public(), nil
}

// RotateRemoteRelayPassword generates a new instance password and registers (or rotates) on the relay.
// First-time setup: Base URL required, existing password optional (empty = first register).
func (s *Service) RotateRemoteRelayPassword(ctx context.Context) (string, error) {
	if s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return "", fmt.Errorf("remote bridge not initialized")
	}
	cfg := s.RemoteBridge.Config.Get()
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return "", fmt.Errorf("请先填写并保存中继 Base URL")
	}
	if strings.TrimSpace(cfg.InstanceID) == "" {
		return "", fmt.Errorf("instance_id missing")
	}
	display := strings.TrimSpace(cfg.DisplayName)
	if display == "" {
		display = cfg.InstanceID
	}
	// 已有有效密码则带旧密码轮换；否则视为首次注册
	prior := ""
	if remotebridge.ValidInstancePassword(cfg.Password) {
		prior = cfg.Password
	}
	plain := remotebridge.GenerateInstancePassword()
	// 先把新密码写入文件，再请求中继。注册成功和写盘之间如果进程退出，重启后仍能用这份待定密码对上服务器。
	if err := s.RemoteBridge.Config.StagePendingPassword(plain); err != nil {
		return "", err
	}
	client := &remotebridge.RelayClient{
		BaseURL:    cfg.BaseURL,
		InstanceID: cfg.InstanceID,
		Password:   plain,
	}
	if err := client.RegisterRetrying(ctx, display, remotebridge.RegisteredActions(), prior); err != nil {
		if remotebridge.RegisterDidNotCommit(err) {
			_ = s.RemoteBridge.Config.ClearPendingPassword()
		}
		if remotebridge.IsTooManyRequests(err) {
			return "", fmt.Errorf("中继注册过于频繁，请约 1 分钟后再点一次")
		}
		if remotebridge.IsUnauthorized(err) {
			return "", fmt.Errorf("中继拒绝了本机保存的实例密码（已过期或与服务器不一致）。请先把最新 remote-relay 更新到中继服务器，再点一次轮换")
		}
		return "", fmt.Errorf("relay register: %w", err)
	}
	if err := s.RemoteBridge.Config.SetPassword(plain); err != nil {
		return "", err
	}
	// 密码已经注册成功，重载循环时不要再打一次注册接口。
	s.RemoteBridge.ReloadWithoutRegister(s.remoteBridgeContext())
	s.RemoteBridge.MarkReachable()
	return plain, nil
}

// GetRemoteRelayStatus returns bridge health fields.
func (s *Service) GetRemoteRelayStatus() RemoteRelayStatus {
	if s.RemoteBridge == nil {
		return remotebridge.Status{}
	}
	return s.RemoteBridge.StatusSnapshot()
}

// ListRemoteRelayMobileSessions proxies to relay device mobile-sessions.
func (s *Service) ListRemoteRelayMobileSessions(ctx context.Context) ([]remotebridge.MobileDeviceSession, error) {
	client, err := s.remoteRelayClient()
	if err != nil {
		return nil, err
	}
	return client.ListMobileSessions(ctx)
}

// KickRemoteRelayMobileSession revokes one mobile unlock session via relay.
func (s *Service) KickRemoteRelayMobileSession(ctx context.Context, sessionID string) error {
	client, err := s.remoteRelayClient()
	if err != nil {
		return err
	}
	return client.KickMobileSession(ctx, sessionID)
}

// remoteRelayClient builds a RelayClient when config has base URL + password.
func (s *Service) remoteRelayClient() (*remotebridge.RelayClient, error) {
	if s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return nil, fmt.Errorf("remote bridge not initialized")
	}
	cfg := s.RemoteBridge.Config.Get()
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("请先配置中继 Base URL")
	}
	if !remotebridge.ValidInstancePassword(cfg.Password) {
		return nil, fmt.Errorf("请先生成并注册实例密码")
	}
	if strings.TrimSpace(cfg.InstanceID) == "" {
		return nil, fmt.Errorf("instance_id missing")
	}
	return &remotebridge.RelayClient{
		BaseURL:    cfg.BaseURL,
		InstanceID: cfg.InstanceID,
		Password:   cfg.Password,
	}, nil
}
