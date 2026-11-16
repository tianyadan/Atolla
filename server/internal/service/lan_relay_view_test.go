package service

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"atolla/server/internal/store"
)

func lanDevice(id, name, clientKey string, updated time.Time) store.LanRelayDevice {
	return store.LanRelayDevice{ID: id, Name: name, ClientKey: clientKey, UpdatedAt: updated}
}

func TestGroupLanRelayDevicesFoldsLegacyDuplicatesByName(t *testing.T) {
	now := time.Now().UTC()
	views := groupLanRelayDevices([]store.LanRelayDevice{
		lanDevice("id-2", "iPhone", "", now),
		lanDevice("id-1", "iPhone", "", now.Add(-time.Minute)),
	})
	if len(views) != 1 {
		t.Fatalf("views=%+v, want one card", views)
	}
	if views[0].PairingCount != 2 || len(views[0].IDs) != 2 || views[0].ID != "id-2" {
		t.Fatalf("view=%+v, want newest representative with both ids", views[0])
	}
}

func TestGroupLanRelayDevicesKeepsDifferentClientKeysSeparate(t *testing.T) {
	now := time.Now().UTC()
	views := groupLanRelayDevices([]store.LanRelayDevice{
		lanDevice("phone-a", "iPhone", "phone-a", now),
		lanDevice("phone-b", "iPhone", "phone-b", now.Add(-time.Minute)),
	})
	if len(views) != 2 {
		t.Fatalf("views=%+v, want one card per client key", views)
	}
}

func TestGroupLanRelayDevicesMergesLegacyIntoUniqueClientCard(t *testing.T) {
	now := time.Now().UTC()
	views := groupLanRelayDevices([]store.LanRelayDevice{
		lanDevice("phone-a", "iPhone", "phone-a", now),
		lanDevice("legacy-1", "iPhone", "", now.Add(-time.Minute)),
		lanDevice("legacy-2", "iPhone", "", now.Add(-2*time.Minute)),
	})
	if len(views) != 1 {
		t.Fatalf("views=%+v, want legacy rows folded into the client card", views)
	}
	if views[0].PairingCount != 3 || len(views[0].IDs) != 3 {
		t.Fatalf("view=%+v, want all credentials behind one revoke action", views[0])
	}
}

func TestGroupLanRelayDevicesSkipsRevoked(t *testing.T) {
	now := time.Now().UTC()
	revokedAt := now
	device := lanDevice("revoked", "iPhone", "", now)
	device.RevokedAt = &revokedAt
	if views := groupLanRelayDevices([]store.LanRelayDevice{device}); len(views) != 0 {
		t.Fatalf("views=%+v, want revoked devices hidden", views)
	}
}

func TestLanRelayPairStatusLifecycle(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "pair-status.db"))
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: st}
	ctx := context.Background()
	now := time.Now().UTC()
	if err := st.CreateLanRelayPairSession(ctx, store.LanRelayPairSession{ID: "pair-1", DeviceID: "device-1", Name: "iPhone", Challenge: "challenge", SecretEnc: "enc", ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	status, err := svc.GetLanRelayPairStatus(ctx, "pair-1")
	if err != nil || status.Status != "pending" || status.SecondsRemaining <= 0 {
		t.Fatalf("pending status=%+v err=%v", status, err)
	}
	if err := st.MarkLanRelayPairSessionScanned(ctx, "pair-1", "challenge", now); err != nil {
		t.Fatal(err)
	}
	status, err = svc.GetLanRelayPairStatus(ctx, "pair-1")
	if err != nil || status.Status != "scanned" || status.ScannedAt == nil {
		t.Fatalf("scanned status=%+v err=%v", status, err)
	}
	if _, err := st.ConsumeLanRelayPairSession(ctx, "pair-1", "challenge", "client-key-0001", now); err != nil {
		t.Fatal(err)
	}
	status, err = svc.GetLanRelayPairStatus(ctx, "pair-1")
	if err != nil || status.Status != "paired" || status.PairedAt == nil || status.DeviceName != "iPhone" {
		t.Fatalf("paired status=%+v err=%v", status, err)
	}
	if _, err := svc.GetLanRelayPairStatus(ctx, "missing"); err != sql.ErrNoRows {
		t.Fatalf("missing session error=%v, want sql.ErrNoRows", err)
	}
}

func TestLanRelayPairStatusExpires(t *testing.T) {
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "pair-expired.db"))
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{Store: st}
	ctx := context.Background()
	if err := st.CreateLanRelayPairSession(ctx, store.LanRelayPairSession{ID: "pair-1", DeviceID: "device-1", Name: "iPhone", Challenge: "challenge", SecretEnc: "enc", ExpiresAt: time.Now().UTC().Add(-time.Minute)}); err != nil {
		t.Fatal(err)
	}
	status, err := svc.GetLanRelayPairStatus(ctx, "pair-1")
	if err != nil || status.Status != "expired" || status.SecondsRemaining != 0 {
		t.Fatalf("expired status=%+v err=%v", status, err)
	}
}

func TestNormalizeLanRelayClientKey(t *testing.T) {
	if key, err := normalizeLanRelayClientKey("  "); err != nil || key != "" {
		t.Fatalf("empty key=%q err=%v", key, err)
	}
	if _, err := normalizeLanRelayClientKey("short"); err == nil {
		t.Fatal("short key should be rejected")
	}
	if _, err := normalizeLanRelayClientKey("bad key with spaces"); err == nil {
		t.Fatal("key with spaces should be rejected")
	}
	valid := "0123456789abcdef0123456789abcdef"
	if key, err := normalizeLanRelayClientKey(valid); err != nil || key != valid {
		t.Fatalf("valid key=%q err=%v", key, err)
	}
}
