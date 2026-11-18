package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func TestLanRelayConfigAndDevicePersistence(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "lan-relay.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := st.PutLanRelayConfig(ctx, LanRelayConfig{Enabled: true, Strategy: "auto", Port: 7943}); err != nil {
		t.Fatal(err)
	}
	cfg, err := st.GetLanRelayConfig(ctx)
	if err != nil || !cfg.Enabled || cfg.Strategy != "auto" || cfg.Port != 7943 {
		t.Fatalf("cfg=%+v err=%v", cfg, err)
	}
	if err := st.CreateLanRelayDevice(ctx, LanRelayDevice{ID: "device-1", Name: "iPhone", SecretEnc: "encrypted"}); err != nil {
		t.Fatal(err)
	}
	if err := st.RevokeLanRelayDevice(ctx, "device-1"); err != nil {
		t.Fatal(err)
	}
	// Revoked credentials must disappear from the management list.
	devices, err := st.ListLanRelayDevices(ctx)
	if err != nil || len(devices) != 0 {
		t.Fatalf("devices=%+v err=%v, want no active devices", devices, err)
	}
}

func TestLanRelayPairSessionCanOnlyBeConsumedOnce(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "pair-session.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now().UTC()
	if err := st.CreateLanRelayPairSession(ctx, LanRelayPairSession{ID: "pair-1", DeviceID: "device-1", Name: "iPhone", Challenge: "challenge", SecretEnc: "encrypted", ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConsumeLanRelayPairSession(ctx, "pair-1", "challenge", "", now); err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if _, err := st.ConsumeLanRelayPairSession(ctx, "pair-1", "challenge", "", now); err != sql.ErrNoRows {
		t.Fatalf("second consume error=%v, want sql.ErrNoRows", err)
	}
	device, err := st.GetLanRelayDevice(ctx, "device-1")
	if err != nil || device.Name != "iPhone" {
		t.Fatalf("device=%+v err=%v", device, err)
	}
}

func TestLanRelayClientKeyReusesSingleDevice(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "client-key.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now().UTC()
	clientKey := "phone-client-key-0001"
	if err := st.CreateLanRelayPairSession(ctx, LanRelayPairSession{ID: "pair-1", DeviceID: "random-1", Name: "iPhone", Challenge: "c1", SecretEnc: "enc-1", ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	first, err := st.ConsumeLanRelayPairSession(ctx, "pair-1", "c1", clientKey, now)
	if err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if first.DeviceID != clientKey {
		t.Fatalf("device id=%q, want client key %q", first.DeviceID, clientKey)
	}
	if err := st.CreateLanRelayPairSession(ctx, LanRelayPairSession{ID: "pair-2", DeviceID: "random-2", Name: "我的 iPhone", Challenge: "c2", SecretEnc: "enc-2", ExpiresAt: now.Add(2 * time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConsumeLanRelayPairSession(ctx, "pair-2", "c2", clientKey, now.Add(time.Minute)); err != nil {
		t.Fatalf("second consume: %v", err)
	}
	devices, err := st.ListLanRelayDevices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 {
		t.Fatalf("devices=%+v, want exactly one card for the same client key", devices)
	}
	if devices[0].ID != clientKey || devices[0].ClientKey != clientKey || devices[0].Name != "我的 iPhone" {
		t.Fatalf("device=%+v, want refreshed client-key device", devices[0])
	}
}

func TestLanRelayNewPairingExpiresOlderSessions(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "pair-expire.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now().UTC()
	if err := st.CreateLanRelayPairSession(ctx, LanRelayPairSession{ID: "pair-1", DeviceID: "device-1", Name: "iPhone", Challenge: "c1", SecretEnc: "enc", ExpiresAt: now.Add(5 * time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if err := st.ExpireLanRelayPairSessions(ctx, now); err != nil {
		t.Fatal(err)
	}
	session, err := st.GetLanRelayPairSession(ctx, "pair-1")
	if err != nil {
		t.Fatal(err)
	}
	if session.ExpiresAt.After(now) {
		t.Fatalf("expires_at=%v, want superseded QR to be expired at %v", session.ExpiresAt, now)
	}
	if _, err := st.ConsumeLanRelayPairSession(ctx, "pair-1", "c1", "", now); err != sql.ErrNoRows {
		t.Fatalf("consume expired session error=%v, want sql.ErrNoRows", err)
	}
}

func TestLanRelayPairSessionScanState(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "scan-state.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now().UTC()
	if err := st.CreateLanRelayPairSession(ctx, LanRelayPairSession{ID: "pair-1", DeviceID: "device-1", Name: "iPhone", Challenge: "challenge", SecretEnc: "encrypted", ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	session, err := st.GetLanRelayPairSession(ctx, "pair-1")
	if err != nil || session.ScannedAt != nil || session.ConsumedAt != nil {
		t.Fatalf("new session=%+v err=%v", session, err)
	}
	if err := st.MarkLanRelayPairSessionScanned(ctx, "pair-1", "challenge", now); err != nil {
		t.Fatalf("mark scanned: %v", err)
	}
	// A repeated scan acknowledgement stays idempotent.
	if err := st.MarkLanRelayPairSessionScanned(ctx, "pair-1", "challenge", now); err != nil {
		t.Fatalf("repeat mark scanned: %v", err)
	}
	session, err = st.GetLanRelayPairSession(ctx, "pair-1")
	if err != nil || session.ScannedAt == nil {
		t.Fatalf("scanned session=%+v err=%v", session, err)
	}
	if err := st.MarkLanRelayPairSessionScanned(ctx, "pair-1", "wrong", now); err != sql.ErrNoRows {
		t.Fatalf("wrong challenge error=%v, want sql.ErrNoRows", err)
	}
}
