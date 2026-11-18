package service

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"atolla/server/internal/lanrelay"
	"atolla/server/internal/store"
	"atolla/server/internal/testsrv"
)

// ApplyLanRelayConfig applies the persisted switch to the independent LAN
// listener. It intentionally does not alter RemoteBridge or any cloud relay
// configuration, so a LAN failure cannot interrupt existing remote access.
func (s *Service) ApplyLanRelayConfig(ctx context.Context) error {
	if s == nil || s.Store == nil {
		return fmt.Errorf("LAN relay service is not initialized")
	}
	cfg, err := s.Store.GetLanRelayConfig(ctx)
	if err != nil {
		return err
	}
	if s.LanRelay == nil {
		s.LanRelay = lanrelay.New(s.lanRelayDeviceSecret, s.executeLanRelayAction)
	}
	// Reads have a different trust and side-effect profile from actions. Always
	// refresh the executor so a restored listener uses the current Service.
	s.LanRelay.SetReadExecutor(s.executeLanRelayRead)
	s.LanRelay.SetImageExecutor(s.readLanRelayImage)
	s.LanRelay.SetPairExecutor(s.ConsumeLanRelayPairing)
	s.LanRelay.SetPairAckExecutor(s.MarkLanRelayPairingScanned)
	s.LanRelay.SetAuditSink(func(ctx context.Context, event lanrelay.AuditEvent) {
		// Audit failures must not turn a successfully authenticated command into
		// a retryable client failure. The event contains no secret or payload.
		_ = s.Store.InsertLanRelayAudit(ctx, store.LanRelayAudit{DeviceID: event.DeviceID, SourceIP: event.SourceIP, Operation: event.Operation, Outcome: event.Outcome, Status: event.Status, Detail: event.Detail})
	})
	if !cfg.Enabled {
		s.LanRelay.Stop()
		return nil
	}
	return s.LanRelay.Start(cfg.Port)
}

func (s *Service) readLanRelayImage(_ context.Context, imageName string) (lanrelay.Image, error) {
	if !isSafeLanImageName(imageName) {
		return lanrelay.Image{}, fmt.Errorf("invalid image name")
	}
	data, err := os.ReadFile(filepath.Join(s.ChatImageDir(), imageName))
	if err != nil {
		return lanrelay.Image{}, err
	}
	contentType := "image/jpeg"
	switch strings.ToLower(filepath.Ext(imageName)) {
	case ".png":
		contentType = "image/png"
	case ".webp":
		contentType = "image/webp"
	}
	return lanrelay.Image{Data: data, ContentType: contentType}, nil
}

func isSafeLanImageName(name string) bool {
	if name == "" || strings.ContainsAny(name, `/\\`) || strings.Contains(name, "..") {
		return false
	}
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") || strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".webp")
}

func (s *Service) executeLanRelayAction(ctx context.Context, action string, payload map[string]any) (any, error) {
	if s.RemoteBridge == nil {
		return nil, fmt.Errorf("remote bridge runtime is unavailable")
	}
	return s.RemoteBridge.ExecuteAction(ctx, action, payload)
}

// LanRelayStatus exposes listener state to the authenticated desktop UI.
func (s *Service) LanRelayStatus() lanrelay.Status {
	if s == nil || s.LanRelay == nil {
		return lanrelay.Status{}
	}
	return s.LanRelay.Status()
}

func (s *Service) lanRelayDeviceSecret(ctx context.Context, deviceID string) (string, bool, error) {
	device, err := s.Store.GetLanRelayDevice(ctx, strings.TrimSpace(deviceID))
	if err != nil {
		if err == sql.ErrNoRows {
			return "", false, nil
		}
		return "", false, err
	}
	if device.RevokedAt != nil {
		return "", false, nil
	}
	secret, err := testsrv.DecryptPassword(s.Cfg.SecretKey, device.SecretEnc)
	if err != nil {
		return "", false, fmt.Errorf("decrypt LAN relay device secret: %w", err)
	}
	return secret, true, nil
}
