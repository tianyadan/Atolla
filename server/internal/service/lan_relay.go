package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"atolla/server/internal/store"
	"atolla/server/internal/testsrv"
)

// lanRelayPairTTL is intentionally short: a QR grants one device key.
const lanRelayPairTTL = 5 * time.Minute

type LanRelayConfigUpdate struct {
	Enabled  bool   `json:"enabled"`
	Strategy string `json:"strategy"`
	Port     int    `json:"port"`
}
type LanRelayPairDeviceRequest struct {
	Name string `json:"name"`
}
type LanRelayPairDeviceResult struct {
	PairingID     string    `json:"pairing_id"`
	QRCodePayload string    `json:"qr_code_payload"`
	ExpiresAt     time.Time `json:"expires_at"`
	// DeviceSecret is intentionally empty when the session is created. It is
	// only returned by the LAN endpoint after a successful one-time consume.
	DeviceSecret string `json:"device_secret,omitempty"`
}

type LanRelayPairingPayload struct {
	Version int `json:"version"`
	// InstanceID lets the iPhone route the completed pairing without asking the
	// person to transcribe an internal identifier before scanning.
	InstanceID string   `json:"instance_id"`
	SessionID  string   `json:"session_id"`
	Challenge  string   `json:"challenge"`
	BaseURLs   []string `json:"base_urls"`
	ExpiresAt  int64    `json:"expires_at"`
}

// LanRelayDeviceView is one logical phone card. A phone may have paired more
// than once; IDs lists every active credential that belongs to that card so a
// single revoke action invalidates all of them.
type LanRelayDeviceView struct {
	ID           string    `json:"id"`
	IDs          []string  `json:"ids"`
	Name         string    `json:"name"`
	ClientKey    string    `json:"client_key,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	PairingCount int       `json:"pairing_count"`
}

// LanRelayPairStatus drives the desktop QR state machine.
type LanRelayPairStatus struct {
	PairingID        string     `json:"pairing_id"`
	Status           string     `json:"status"` // pending | scanned | paired | expired
	ExpiresAt        time.Time  `json:"expires_at"`
	SecondsRemaining int        `json:"seconds_remaining"`
	ScannedAt        *time.Time `json:"scanned_at,omitempty"`
	PairedAt         *time.Time `json:"paired_at,omitempty"`
	DeviceName       string     `json:"device_name,omitempty"`
}

func (s *Service) GetLanRelayConfig(ctx context.Context) (store.LanRelayConfig, error) {
	return s.Store.GetLanRelayConfig(ctx)
}

func (s *Service) UpdateLanRelayConfig(ctx context.Context, in LanRelayConfigUpdate) (store.LanRelayConfig, error) {
	in.Strategy = strings.ToLower(strings.TrimSpace(in.Strategy))
	if in.Strategy == "" {
		in.Strategy = "auto"
	}
	if in.Strategy != "auto" && in.Strategy != "lan_only" && in.Strategy != "cloud_only" {
		return store.LanRelayConfig{}, fmt.Errorf("invalid strategy")
	}
	if in.Port == 0 {
		in.Port = 7943
	}
	if in.Port < 1024 || in.Port > 65535 {
		return store.LanRelayConfig{}, fmt.Errorf("port must be between 1024 and 65535")
	}
	if err := s.Store.PutLanRelayConfig(ctx, store.LanRelayConfig{Enabled: in.Enabled, Strategy: in.Strategy, Port: in.Port}); err != nil {
		return store.LanRelayConfig{}, err
	}
	return s.Store.GetLanRelayConfig(ctx)
}

// ListLanRelayDevices returns one card per physical phone. Devices recorded by
// older clients have no client key; those legacy rows are folded into the
// single client-key card with the same name when it is unambiguous.
func (s *Service) ListLanRelayDevices(ctx context.Context) ([]LanRelayDeviceView, error) {
	rows, err := s.Store.ListLanRelayDevices(ctx)
	if err != nil {
		return nil, err
	}
	return groupLanRelayDevices(rows), nil
}

func groupLanRelayDevices(rows []store.LanRelayDevice) []LanRelayDeviceView {
	type group struct {
		view   *LanRelayDeviceView
		legacy bool
		name   string
	}
	groups := make([]*group, 0, len(rows))
	byClient := map[string]*group{}
	legacyByName := map[string]*group{}
	for _, device := range rows {
		if device.RevokedAt != nil {
			continue
		}
		if device.ClientKey != "" {
			if existing := byClient[device.ClientKey]; existing != nil {
				existing.view.IDs = append(existing.view.IDs, device.ID)
				existing.view.PairingCount++
				if device.UpdatedAt.After(existing.view.UpdatedAt) {
					existing.view.UpdatedAt = device.UpdatedAt
				}
				continue
			}
			view := &LanRelayDeviceView{
				ID:           device.ID,
				IDs:          []string{device.ID},
				Name:         device.Name,
				ClientKey:    device.ClientKey,
				CreatedAt:    device.CreatedAt,
				UpdatedAt:    device.UpdatedAt,
				PairingCount: 1,
			}
			current := &group{view: view, name: device.Name}
			byClient[device.ClientKey] = current
			groups = append(groups, current)
			continue
		}
		if existing := legacyByName[device.Name]; existing != nil {
			existing.view.IDs = append(existing.view.IDs, device.ID)
			existing.view.PairingCount++
			if device.UpdatedAt.After(existing.view.UpdatedAt) {
				existing.view.UpdatedAt = device.UpdatedAt
			}
			continue
		}
		view := &LanRelayDeviceView{
			ID:           device.ID,
			IDs:          []string{device.ID},
			Name:         device.Name,
			CreatedAt:    device.CreatedAt,
			UpdatedAt:    device.UpdatedAt,
			PairingCount: 1,
		}
		current := &group{view: view, legacy: true, name: device.Name}
		legacyByName[device.Name] = current
		groups = append(groups, current)
	}

	clientsByName := map[string][]*group{}
	for _, current := range groups {
		if !current.legacy {
			clientsByName[current.name] = append(clientsByName[current.name], current)
		}
	}
	kept := make([]*group, 0, len(groups))
	for _, current := range groups {
		if current.legacy {
			// Only merge when a single client-key card owns that name; otherwise
			// two distinct phones could be hidden behind one revoke action.
			if matches := clientsByName[current.name]; len(matches) == 1 {
				target := matches[0]
				target.view.IDs = append(target.view.IDs, current.view.IDs...)
				target.view.PairingCount += current.view.PairingCount
				if current.view.UpdatedAt.After(target.view.UpdatedAt) {
					target.view.UpdatedAt = current.view.UpdatedAt
				}
				continue
			}
		}
		kept = append(kept, current)
	}
	out := make([]LanRelayDeviceView, 0, len(kept))
	for _, current := range kept {
		out = append(out, *current.view)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].UpdatedAt.After(out[j].UpdatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (s *Service) RevokeLanRelayDevice(ctx context.Context, id string) error {
	return s.Store.RevokeLanRelayDevice(ctx, strings.TrimSpace(id))
}

// RevokeLanRelayDevices revokes every credential behind one UI card. Already
// revoked ids are ignored so a retried request is safe.
func (s *Service) RevokeLanRelayDevices(ctx context.Context, ids []string) (int, error) {
	seen := map[string]bool{}
	revoked := 0
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		err := s.Store.RevokeLanRelayDevice(ctx, id)
		if err == nil {
			revoked++
			continue
		}
		if err == sql.ErrNoRows {
			continue
		}
		return revoked, err
	}
	return revoked, nil
}

func (s *Service) ListLanRelayAudits(ctx context.Context, limit int) ([]store.LanRelayAudit, error) {
	return s.Store.ListLanRelayAudits(ctx, limit)
}

// PairLanRelayDevice creates a one-time pairing session.  The generated QR
// never contains a reusable device secret, which prevents a copied desktop QR
// from becoming a permanent credential.
func (s *Service) PairLanRelayDevice(ctx context.Context, in LanRelayPairDeviceRequest) (LanRelayPairDeviceResult, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 128 {
		return LanRelayPairDeviceResult{}, fmt.Errorf("device name must be 1-128 characters")
	}
	sessionID, err := lanRelayRandom(18)
	if err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	secret, err := lanRelayRandom(32)
	if err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	enc, err := testsrv.EncryptPassword(s.Cfg.SecretKey, secret)
	if err != nil {
		return LanRelayPairDeviceResult{}, fmt.Errorf("encrypt device secret: %w", err)
	}
	deviceID, err := lanRelayRandom(18)
	if err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	challenge, err := lanRelayRandom(18)
	if err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	expiresAt := time.Now().Add(lanRelayPairTTL).UTC()
	// Only the newest QR may be redeemed; an older one still on screen becomes
	// invalid the moment a replacement is generated.
	if err := s.Store.ExpireLanRelayPairSessions(ctx, time.Now().UTC()); err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	if err := s.Store.CreateLanRelayPairSession(ctx, store.LanRelayPairSession{ID: sessionID, DeviceID: deviceID, Name: name, Challenge: challenge, SecretEnc: enc, ExpiresAt: expiresAt}); err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	cfg, err := s.Store.GetLanRelayConfig(ctx)
	if err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	instanceID := ""
	if s.RemoteBridge != nil {
		instanceID = s.RemoteBridge.Config.Public().InstanceID
	}
	payload, err := json.Marshal(buildLanRelayPairingPayload(instanceID, sessionID, challenge, lanRelayBaseURLs(cfg.Port), expiresAt))
	if err != nil {
		return LanRelayPairDeviceResult{}, err
	}
	return LanRelayPairDeviceResult{PairingID: sessionID, QRCodePayload: string(payload), ExpiresAt: expiresAt}, nil
}

func buildLanRelayPairingPayload(instanceID, sessionID, challenge string, baseURLs []string, expiresAt time.Time) LanRelayPairingPayload {
	return LanRelayPairingPayload{Version: 1, InstanceID: strings.TrimSpace(instanceID), SessionID: sessionID, Challenge: challenge, BaseURLs: baseURLs, ExpiresAt: expiresAt.Unix()}
}

// ConsumeLanRelayPairing is called only by the LAN listener after verifying
// the private source address.  Store-level conditional consume prevents a
// second scan racing the first from receiving the same secret.
func (s *Service) ConsumeLanRelayPairing(ctx context.Context, sessionID, challenge, clientKey string) (string, string, error) {
	key, err := normalizeLanRelayClientKey(clientKey)
	if err != nil {
		return "", "", err
	}
	pair, err := s.Store.ConsumeLanRelayPairSession(ctx, strings.TrimSpace(sessionID), strings.TrimSpace(challenge), key, time.Now().UTC())
	if err != nil {
		return "", "", fmt.Errorf("pairing session expired, invalid, or already used")
	}
	secret, err := testsrv.DecryptPassword(s.Cfg.SecretKey, pair.SecretEnc)
	if err != nil {
		return "", "", fmt.Errorf("decrypt pairing secret: %w", err)
	}
	return pair.DeviceID, secret, nil
}

// MarkLanRelayPairingScanned lets the desktop show "iPhone 已扫描" while the
// phone is still completing the pairing request. It is advisory only.
func (s *Service) MarkLanRelayPairingScanned(ctx context.Context, sessionID, challenge string) error {
	return s.Store.MarkLanRelayPairSessionScanned(ctx, strings.TrimSpace(sessionID), strings.TrimSpace(challenge), time.Now().UTC())
}

// GetLanRelayPairStatus reports the QR lifecycle for the desktop poller.
func (s *Service) GetLanRelayPairStatus(ctx context.Context, sessionID string) (LanRelayPairStatus, error) {
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return LanRelayPairStatus{}, sql.ErrNoRows
	}
	pair, err := s.Store.GetLanRelayPairSession(ctx, id)
	if err != nil {
		return LanRelayPairStatus{}, err
	}
	now := time.Now().UTC()
	out := LanRelayPairStatus{PairingID: pair.ID, ExpiresAt: pair.ExpiresAt, DeviceName: pair.Name, ScannedAt: pair.ScannedAt}
	switch {
	case pair.ConsumedAt != nil:
		out.Status = "paired"
		out.PairedAt = pair.ConsumedAt
	case !pair.ExpiresAt.After(now):
		out.Status = "expired"
	case pair.ScannedAt != nil:
		out.Status = "scanned"
	default:
		out.Status = "pending"
	}
	if out.Status == "pending" || out.Status == "scanned" {
		if remaining := int(pair.ExpiresAt.Sub(now).Seconds()); remaining > 0 {
			out.SecondsRemaining = remaining
		}
	}
	return out, nil
}

// normalizeLanRelayClientKey accepts the stable per-install identifier sent by
// the iPhone. It becomes a device primary key, so only a conservative alphabet
// is allowed. An empty value preserves the legacy random-device-id behaviour.
func normalizeLanRelayClientKey(raw string) (string, error) {
	key := strings.TrimSpace(raw)
	if key == "" {
		return "", nil
	}
	if len(key) < 16 || len(key) > 96 {
		return "", fmt.Errorf("invalid client key")
	}
	for _, ch := range key {
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			continue
		}
		return "", fmt.Errorf("invalid client key")
	}
	return key, nil
}

func lanRelayBaseURLs(port int) []string {
	urls := make([]string, 0)
	seen := map[string]bool{}
	interfaces, _ := net.Interfaces()
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			ip, _, err := net.ParseCIDR(address.String())
			if err != nil || ip == nil || !ip.IsPrivate() || ip.To4() == nil {
				continue
			}
			base := fmt.Sprintf("http://%s:%d", ip.String(), port)
			if !seen[base] {
				seen[base] = true
				urls = append(urls, base)
			}
		}
	}
	sort.Strings(urls)
	return urls
}

func lanRelayRandom(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
