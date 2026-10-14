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
	s.RemoteBridge.Reload(s.remoteBridgeContext())
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
	client := &remotebridge.RelayClient{
		BaseURL:    cfg.BaseURL,
		InstanceID: cfg.InstanceID,
		Password:   plain,
	}
	if err := client.Register(ctx, display, remotebridge.RegisteredActions(), prior); err != nil {
		return "", fmt.Errorf("relay register: %w", err)
	}
	if err := s.RemoteBridge.Config.SetPassword(plain); err != nil {
		return "", err
	}
	// 首次生成密码后若已勾选启用，Reload 会真正拉起出站循环
	s.RemoteBridge.Reload(s.remoteBridgeContext())
	return plain, nil
}

// GetRemoteRelayStatus returns bridge health fields.
func (s *Service) GetRemoteRelayStatus() RemoteRelayStatus {
	if s.RemoteBridge == nil {
		return remotebridge.Status{}
	}
	return s.RemoteBridge.StatusSnapshot()
}
