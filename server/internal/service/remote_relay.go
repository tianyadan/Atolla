package service

import (
	"context"
	"fmt"

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
	s.RemoteBridge.Reload(ctx)
	return s.RemoteBridge.Config.Public(), nil
}

// RotateRemoteRelayPassword generates a new instance password and re-registers.
func (s *Service) RotateRemoteRelayPassword(ctx context.Context) (string, error) {
	if s.RemoteBridge == nil || s.RemoteBridge.Config == nil {
		return "", fmt.Errorf("remote bridge not initialized")
	}
	plain := remotebridge.GenerateInstancePassword()
	if err := s.RemoteBridge.Config.SetPassword(plain); err != nil {
		return "", err
	}
	s.RemoteBridge.TriggerReregister()
	s.RemoteBridge.Reload(ctx)
	return plain, nil
}

// GetRemoteRelayStatus returns bridge health fields.
func (s *Service) GetRemoteRelayStatus() RemoteRelayStatus {
	if s.RemoteBridge == nil {
		return remotebridge.Status{}
	}
	return s.RemoteBridge.StatusSnapshot()
}
