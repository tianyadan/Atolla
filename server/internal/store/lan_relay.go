package store

import (
	"context"
	"database/sql"
	"time"
)

// LanRelayConfig is the persisted, non-secret configuration for the local-only relay.
type LanRelayConfig struct {
	Enabled   bool      `json:"enabled"`
	Strategy  string    `json:"strategy"`
	Port      int       `json:"port"`
	UpdatedAt time.Time `json:"updated_at"`
}

// LanRelayDevice keeps only the encrypted per-device secret; API responses must not expose it.
// ClientKey is the stable identifier generated once per iPhone install. Re-pairing
// the same phone reuses it so the device list keeps exactly one active record.
type LanRelayDevice struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	ClientKey string     `json:"client_key,omitempty"`
	SecretEnc string     `json:"-"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
}

// LanRelayPairSession is deliberately separate from a paired device.  A QR
// code grants only this short-lived challenge; the long-lived device key is
// returned once, over the local connection, when the session is consumed.
type LanRelayPairSession struct {
	ID         string
	DeviceID   string
	Name       string
	Challenge  string
	SecretEnc  string
	ExpiresAt  time.Time
	ScannedAt  *time.Time
	ConsumedAt *time.Time
}

// LanRelayAudit is a redacted, append-only security record. Request bodies and
// device secrets are deliberately never stored in it.
type LanRelayAudit struct {
	ID        int64     `json:"id"`
	DeviceID  string    `json:"device_id,omitempty"`
	SourceIP  string    `json:"source_ip"`
	Operation string    `json:"operation"`
	Outcome   string    `json:"outcome"`
	Status    int       `json:"status"`
	Detail    string    `json:"detail,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) EnsureLanRelaySchema(ctx context.Context) error {
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS lan_relay_config (
		  id BIGINT NOT NULL,
		  enabled TINYINT NOT NULL DEFAULT 0,
		  strategy VARCHAR(16) NOT NULL DEFAULT 'auto',
		  port INT NOT NULL DEFAULT 7943,
		  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS lan_relay_devices (
		  id VARCHAR(96) NOT NULL,
		  name VARCHAR(128) NOT NULL,
		  client_key VARCHAR(96) NULL,
		  secret_enc TEXT NOT NULL,
		  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  revoked_at DATETIME NULL,
		  PRIMARY KEY (id)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS lan_relay_pair_sessions (
		  id VARCHAR(96) NOT NULL,
		  device_id VARCHAR(96) NOT NULL,
		  name VARCHAR(128) NOT NULL,
		  challenge VARCHAR(128) NOT NULL,
		  secret_enc TEXT NOT NULL,
		  expires_at DATETIME NOT NULL,
		  scanned_at DATETIME NULL,
		  consumed_at DATETIME NULL,
		  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  UNIQUE KEY uk_lan_relay_pair_device_id (device_id)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	// Existing installations predate these columns; add them without rewriting data.
	if err := s.addColumnIfMissing(ctx, "lan_relay_devices", "client_key",
		`ALTER TABLE lan_relay_devices ADD COLUMN client_key VARCHAR(96) NULL`); err != nil {
		return err
	}
	if err := s.addColumnIfMissing(ctx, "lan_relay_pair_sessions", "scanned_at",
		`ALTER TABLE lan_relay_pair_sessions ADD COLUMN scanned_at DATETIME NULL`); err != nil {
		return err
	}
	// kept separate from paired-device data so retention can later be changed
	// without weakening credential storage.
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS lan_relay_audits (
		  id BIGINT NOT NULL AUTO_INCREMENT,
		  device_id VARCHAR(96) NOT NULL DEFAULT '',
		  source_ip VARCHAR(64) NOT NULL,
		  operation VARCHAR(128) NOT NULL,
		  outcome VARCHAR(32) NOT NULL,
		  status INT NOT NULL,
		  detail VARCHAR(256) NOT NULL DEFAULT '',
		  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  KEY idx_lan_relay_audits_created (created_at)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	return nil
}

func (s *Store) GetLanRelayConfig(ctx context.Context) (LanRelayConfig, error) {
	var out LanRelayConfig
	var enabled int
	err := s.db.QueryRowContext(ctx, `SELECT enabled, strategy, port, updated_at FROM lan_relay_config WHERE id=1`).Scan(&enabled, &out.Strategy, &out.Port, &out.UpdatedAt)
	if err == sql.ErrNoRows {
		return LanRelayConfig{Strategy: "auto", Port: 7943}, nil
	}
	if err != nil {
		return LanRelayConfig{}, err
	}
	out.Enabled = enabled != 0
	return out, nil
}

func (s *Store) PutLanRelayConfig(ctx context.Context, in LanRelayConfig) error {
	q := s.insertOnConflictUpdate(
		`lan_relay_config (id, enabled, strategy, port)`, `(1, ?, ?, ?)`, `id`,
		`enabled=VALUES(enabled), strategy=VALUES(strategy), port=VALUES(port), updated_at=CURRENT_TIMESTAMP`,
		`enabled=excluded.enabled, strategy=excluded.strategy, port=excluded.port, updated_at=CURRENT_TIMESTAMP`)
	_, err := s.db.ExecContext(ctx, q, in.Enabled, in.Strategy, in.Port)
	return err
}

func (s *Store) CreateLanRelayDevice(ctx context.Context, in LanRelayDevice) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO lan_relay_devices (id, name, secret_enc) VALUES (?, ?, ?)`, in.ID, in.Name, in.SecretEnc)
	return err
}

func (s *Store) GetLanRelayDevice(ctx context.Context, id string) (LanRelayDevice, error) {
	var out LanRelayDevice
	var clientKey sql.NullString
	var revoked sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT id, name, client_key, secret_enc, created_at, updated_at, revoked_at FROM lan_relay_devices WHERE id=?`, id).Scan(&out.ID, &out.Name, &clientKey, &out.SecretEnc, &out.CreatedAt, &out.UpdatedAt, &revoked)
	if clientKey.Valid {
		out.ClientKey = clientKey.String
	}
	if revoked.Valid {
		out.RevokedAt = &revoked.Time
	}
	return out, err
}

// ListLanRelayDevices returns active devices only. Revoked credentials must not
// appear in the management UI, otherwise users keep seeing phones they removed.
func (s *Store) ListLanRelayDevices(ctx context.Context) ([]LanRelayDevice, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, client_key, secret_enc, created_at, updated_at, revoked_at FROM lan_relay_devices WHERE revoked_at IS NULL ORDER BY updated_at DESC, created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LanRelayDevice{}
	for rows.Next() {
		var d LanRelayDevice
		var clientKey sql.NullString
		var revoked sql.NullTime
		if err := rows.Scan(&d.ID, &d.Name, &clientKey, &d.SecretEnc, &d.CreatedAt, &d.UpdatedAt, &revoked); err != nil {
			return nil, err
		}
		if clientKey.Valid {
			d.ClientKey = clientKey.String
		}
		if revoked.Valid {
			d.RevokedAt = &revoked.Time
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) RevokeLanRelayDevice(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE lan_relay_devices SET revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ExpireLanRelayPairSessions invalidates every unconsumed QR. A desktop only
// shows one QR at a time, so an older screenshot must not stay redeemable.
func (s *Store) ExpireLanRelayPairSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE lan_relay_pair_sessions SET expires_at=? WHERE consumed_at IS NULL AND expires_at>?`, now, now)
	return err
}

func (s *Store) CreateLanRelayPairSession(ctx context.Context, in LanRelayPairSession) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO lan_relay_pair_sessions (id, device_id, name, challenge, secret_enc, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, in.ID, in.DeviceID, in.Name, in.Challenge, in.SecretEnc, in.ExpiresAt)
	return err
}

// GetLanRelayPairSession returns a pairing session for status polling. The QR
// screen uses it to move from pending to scanned/paired/expired.
func (s *Store) GetLanRelayPairSession(ctx context.Context, id string) (LanRelayPairSession, error) {
	var out LanRelayPairSession
	var scanned, consumed sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT id, device_id, name, challenge, secret_enc, expires_at, scanned_at, consumed_at FROM lan_relay_pair_sessions WHERE id=?`, id).
		Scan(&out.ID, &out.DeviceID, &out.Name, &out.Challenge, &out.SecretEnc, &out.ExpiresAt, &scanned, &consumed)
	if scanned.Valid {
		out.ScannedAt = &scanned.Time
	}
	if consumed.Valid {
		out.ConsumedAt = &consumed.Time
	}
	return out, err
}

// MarkLanRelayPairSessionScanned records that the iPhone opened the QR before
// it consumes the session. It is advisory state only and never grants access.
func (s *Store) MarkLanRelayPairSessionScanned(ctx context.Context, id, challenge string, now time.Time) error {
	res, err := s.db.ExecContext(ctx, `UPDATE lan_relay_pair_sessions SET scanned_at=? WHERE id=? AND challenge=? AND consumed_at IS NULL AND expires_at>? AND scanned_at IS NULL`, now, id, challenge, now)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		// Already scanned is still a valid scan; distinguish it from an
		// invalid/expired session so retries stay usable.
		var exists int
		if queryErr := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM lan_relay_pair_sessions WHERE id=? AND challenge=? AND consumed_at IS NULL AND expires_at>?`, id, challenge, now).Scan(&exists); queryErr != nil {
			return queryErr
		}
		if exists == 0 {
			return sql.ErrNoRows
		}
	}
	return nil
}

// ConsumeLanRelayPairSession atomically marks a session used and creates (or
// refreshes) the device record.  The conditional update is essential: two
// camera scans must never obtain the same long-lived credential.
//
// clientKey is the stable per-install identifier sent by the iPhone. When it is
// present the device row is keyed by it, so repeated pairings of one phone
// update that single card instead of creating another device.
func (s *Store) ConsumeLanRelayPairSession(ctx context.Context, id, challenge, clientKey string, now time.Time) (LanRelayPairSession, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LanRelayPairSession{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var out LanRelayPairSession
	var scanned, consumed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT id, device_id, name, challenge, secret_enc, expires_at, scanned_at, consumed_at FROM lan_relay_pair_sessions WHERE id=?`, id).
		Scan(&out.ID, &out.DeviceID, &out.Name, &out.Challenge, &out.SecretEnc, &out.ExpiresAt, &scanned, &consumed)
	if err != nil {
		return LanRelayPairSession{}, err
	}
	if out.Challenge != challenge || consumed.Valid || !out.ExpiresAt.After(now) {
		return LanRelayPairSession{}, sql.ErrNoRows
	}
	res, err := tx.ExecContext(ctx, `UPDATE lan_relay_pair_sessions SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?`, now, id, now)
	if err != nil {
		return LanRelayPairSession{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return LanRelayPairSession{}, err
	}
	if n != 1 {
		return LanRelayPairSession{}, sql.ErrNoRows
	}
	deviceID := out.DeviceID
	if clientKey != "" {
		deviceID = clientKey
	}
	if err = upsertLanRelayDeviceTx(ctx, tx, deviceID, out.Name, clientKey, out.SecretEnc, now); err != nil {
		return LanRelayPairSession{}, err
	}
	if err = tx.Commit(); err != nil {
		return LanRelayPairSession{}, err
	}
	out.DeviceID = deviceID
	if scanned.Valid {
		out.ScannedAt = &scanned.Time
	}
	out.ConsumedAt = &now
	return out, nil
}

// upsertLanRelayDeviceTx updates the existing card or inserts a new one. A
// concurrent pairing with the same client key can win the insert race, so a
// failed insert falls back to the update.
func upsertLanRelayDeviceTx(ctx context.Context, tx *sql.Tx, id, name, clientKey, secretEnc string, now time.Time) error {
	client := sql.NullString{String: clientKey, Valid: clientKey != ""}
	res, err := tx.ExecContext(ctx, `UPDATE lan_relay_devices SET name=?, secret_enc=?, client_key=?, revoked_at=NULL, updated_at=? WHERE id=?`, name, secretEnc, client, now, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, insertErr := tx.ExecContext(ctx, `INSERT INTO lan_relay_devices (id, name, client_key, secret_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, id, name, client, secretEnc, now, now)
	if insertErr == nil {
		return nil
	}
	// Another transaction inserted the same id between UPDATE and INSERT.
	retry, retryErr := tx.ExecContext(ctx, `UPDATE lan_relay_devices SET name=?, secret_enc=?, client_key=?, revoked_at=NULL, updated_at=? WHERE id=?`, name, secretEnc, client, now, id)
	if retryErr != nil {
		return retryErr
	}
	if rows, rowsErr := retry.RowsAffected(); rowsErr == nil && rows > 0 {
		return nil
	}
	return insertErr
}

func (s *Store) InsertLanRelayAudit(ctx context.Context, audit LanRelayAudit) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO lan_relay_audits (device_id, source_ip, operation, outcome, status, detail) VALUES (?, ?, ?, ?, ?, ?)`, audit.DeviceID, audit.SourceIP, audit.Operation, audit.Outcome, audit.Status, audit.Detail)
	return err
}

func (s *Store) ListLanRelayAudits(ctx context.Context, limit int) ([]LanRelayAudit, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, device_id, source_ip, operation, outcome, status, detail, created_at FROM lan_relay_audits ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]LanRelayAudit, 0, limit)
	for rows.Next() {
		var item LanRelayAudit
		if err := rows.Scan(&item.ID, &item.DeviceID, &item.SourceIP, &item.Operation, &item.Outcome, &item.Status, &item.Detail, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
