package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ServerSource is one SSH-managed server for the server_control skill.
type ServerSource struct {
	ID                 int64     `json:"id"`
	AgentID            int64     `json:"agent_id"`
	Name               string    `json:"name"`
	Host               string    `json:"host"`
	Port               int       `json:"port"`
	Username           string    `json:"username"`
	PasswordSet        bool      `json:"password_set"`
	AllowDelete        bool      `json:"allow_delete"`         // 勾选后仍须每次询问
	AllowDockerRestart bool      `json:"allow_docker_restart"` // 勾选后仍须每次询问
	Enabled            bool      `json:"enabled"`
	Reachable          bool      `json:"reachable"` // last known / test result
	LastTestAt         *time.Time `json:"last_test_at,omitempty"`
	LastTestError      string    `json:"last_test_error,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	PasswordEnc        string    `json:"-"`
}

// ServerSourceInput create/update body.
type ServerSourceInput struct {
	Name               string `json:"name"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Username           string `json:"username"`
	Password           string `json:"password"`
	ClearPassword      bool   `json:"clear_password"`
	AllowDelete        *bool  `json:"allow_delete"`
	AllowDockerRestart *bool  `json:"allow_docker_restart"`
	Enabled            *bool  `json:"enabled"`
}

// EnsureServerSourceSchema creates agent_server_sources.
func (s *Store) EnsureServerSourceSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS agent_server_sources (
  id BIGINT NOT NULL AUTO_INCREMENT,
  agent_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL,
  host VARCHAR(512) NOT NULL,
  port INT NOT NULL DEFAULT 22,
  username VARCHAR(128) NOT NULL DEFAULT '',
  password_enc TEXT NULL,
  allow_delete TINYINT(1) NOT NULL DEFAULT 0,
  allow_docker_restart TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  reachable TINYINT(1) NOT NULL DEFAULT 0,
  last_test_at DATETIME(3) NULL,
  last_test_error VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ass_agent (agent_id),
  CONSTRAINT fk_ass_agent FOREIGN KEY (agent_id) REFERENCES managed_agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

// ListServerSources returns servers for an agent (no password plaintext).
func (s *Store) ListServerSources(ctx context.Context, agentID int64) ([]ServerSource, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, agent_id, name, host, port, username,
       (password_enc IS NOT NULL AND password_enc <> '') AS pwd,
       allow_delete, allow_docker_restart, enabled, reachable,
       last_test_at, IFNULL(last_test_error,''), created_at, updated_at
FROM agent_server_sources WHERE agent_id=? ORDER BY id ASC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ServerSource
	for rows.Next() {
		src, err := scanServerSourceList(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, src)
	}
	return out, rows.Err()
}

func scanServerSourceList(rows *sql.Rows) (ServerSource, error) {
	var src ServerSource
	var pwd, ad, adr, en, reach int
	var lastTest sql.NullTime
	err := rows.Scan(
		&src.ID, &src.AgentID, &src.Name, &src.Host, &src.Port, &src.Username, &pwd,
		&ad, &adr, &en, &reach, &lastTest, &src.LastTestError, &src.CreatedAt, &src.UpdatedAt,
	)
	if err != nil {
		return src, err
	}
	src.PasswordSet = pwd == 1
	src.AllowDelete = ad == 1
	src.AllowDockerRestart = adr == 1
	src.Enabled = en == 1
	src.Reachable = reach == 1
	if lastTest.Valid {
		t := lastTest.Time
		src.LastTestAt = &t
	}
	return src, nil
}

// GetServerSource returns one server including password_enc.
func (s *Store) GetServerSource(ctx context.Context, agentID, id int64) (ServerSource, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, agent_id, name, host, port, username, COALESCE(password_enc,''),
       (password_enc IS NOT NULL AND password_enc <> '') AS pwd,
       allow_delete, allow_docker_restart, enabled, reachable,
       last_test_at, IFNULL(last_test_error,''), created_at, updated_at
FROM agent_server_sources WHERE agent_id=? AND id=?`, agentID, id)
	var src ServerSource
	var pwd, ad, adr, en, reach int
	var lastTest sql.NullTime
	err := row.Scan(
		&src.ID, &src.AgentID, &src.Name, &src.Host, &src.Port, &src.Username, &src.PasswordEnc, &pwd,
		&ad, &adr, &en, &reach, &lastTest, &src.LastTestError, &src.CreatedAt, &src.UpdatedAt,
	)
	if err != nil {
		return src, err
	}
	src.PasswordSet = pwd == 1
	src.AllowDelete = ad == 1
	src.AllowDockerRestart = adr == 1
	src.Enabled = en == 1
	src.Reachable = reach == 1
	if lastTest.Valid {
		t := lastTest.Time
		src.LastTestAt = &t
	}
	return src, nil
}

// CreateServerSource inserts a server (password already encrypted).
func (s *Store) CreateServerSource(ctx context.Context, agentID int64, in ServerSourceInput, passwordEnc string) (ServerSource, error) {
	name := strings.TrimSpace(in.Name)
	host := strings.TrimSpace(in.Host)
	user := strings.TrimSpace(in.Username)
	port := in.Port
	if port <= 0 {
		port = 22
	}
	if name == "" || host == "" || user == "" {
		return ServerSource{}, fmt.Errorf("name, host, username required")
	}
	ad, adr := false, false
	if in.AllowDelete != nil {
		ad = *in.AllowDelete
	}
	if in.AllowDockerRestart != nil {
		adr = *in.AllowDockerRestart
	}
	res, err := s.db.ExecContext(ctx, `
INSERT INTO agent_server_sources
 (agent_id, name, host, port, username, password_enc, allow_delete, allow_docker_restart, enabled)
VALUES (?,?,?,?,?,?,?,?,1)`,
		agentID, name, host, port, user, nullIfEmpty(passwordEnc), bool01(ad), bool01(adr),
	)
	if err != nil {
		return ServerSource{}, err
	}
	id, _ := res.LastInsertId()
	return s.GetServerSource(ctx, agentID, id)
}

// UpdateServerSource patches a server. passEnc nil=keep, ""=clear.
func (s *Store) UpdateServerSource(ctx context.Context, agentID, id int64, in ServerSourceInput, passEnc *string) (ServerSource, error) {
	cur, err := s.GetServerSource(ctx, agentID, id)
	if err != nil {
		return cur, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = cur.Name
	}
	host := strings.TrimSpace(in.Host)
	if host == "" {
		host = cur.Host
	}
	user := strings.TrimSpace(in.Username)
	if user == "" {
		user = cur.Username
	}
	port := in.Port
	if port <= 0 {
		port = cur.Port
	}
	if port <= 0 {
		port = 22
	}
	ad, adr, en := cur.AllowDelete, cur.AllowDockerRestart, cur.Enabled
	if in.AllowDelete != nil {
		ad = *in.AllowDelete
	}
	if in.AllowDockerRestart != nil {
		adr = *in.AllowDockerRestart
	}
	if in.Enabled != nil {
		en = *in.Enabled
	}
	enc := cur.PasswordEnc
	if passEnc != nil {
		enc = *passEnc
	}
	_, err = s.db.ExecContext(ctx, `
UPDATE agent_server_sources SET name=?, host=?, port=?, username=?, password_enc=?,
 allow_delete=?, allow_docker_restart=?, enabled=? WHERE agent_id=? AND id=?`,
		name, host, port, user, nullIfEmpty(enc), bool01(ad), bool01(adr), bool01(en), agentID, id,
	)
	if err != nil {
		return cur, err
	}
	return s.GetServerSource(ctx, agentID, id)
}

// SetServerSourceTestResult updates reachability after a connection test.
func (s *Store) SetServerSourceTestResult(ctx context.Context, agentID, id int64, ok bool, errMsg string) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE agent_server_sources SET reachable=?, last_test_at=CURRENT_TIMESTAMP(3), last_test_error=?
 WHERE agent_id=? AND id=?`, bool01(ok), truncateStr(errMsg, 500), agentID, id)
	return err
}

// DeleteServerSource removes one server.
func (s *Store) DeleteServerSource(ctx context.Context, agentID, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM agent_server_sources WHERE agent_id=? AND id=?`, agentID, id)
	if err != nil {
		return err
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteAllServerSources clears all servers for an agent.
func (s *Store) DeleteAllServerSources(ctx context.Context, agentID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_server_sources WHERE agent_id=?`, agentID)
	return err
}

// AgentServerControlFlags aggregates OR of enabled servers' permission checkboxes.
func (s *Store) AgentServerControlFlags(ctx context.Context, agentID int64) (installed, allowDelete, allowDockerRestart bool, err error) {
	// installed checked by caller via skills; here only aggregate flags
	rows, err := s.db.QueryContext(ctx, `
SELECT allow_delete, allow_docker_restart FROM agent_server_sources WHERE agent_id=? AND enabled=1`, agentID)
	if err != nil {
		return false, false, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var ad, adr int
		if err := rows.Scan(&ad, &adr); err != nil {
			return false, false, false, err
		}
		if ad == 1 {
			allowDelete = true
		}
		if adr == 1 {
			allowDockerRestart = true
		}
	}
	return true, allowDelete, allowDockerRestart, rows.Err()
}

// FormatServerSourcesPromptCompact builds minimal prompt (no secrets).
func FormatServerSourcesPromptCompact(sources []ServerSource) string {
	enabled := make([]ServerSource, 0, len(sources))
	for _, s := range sources {
		if s.Enabled {
			enabled = append(enabled, s)
		}
	}
	if len(enabled) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Servers (compact)\n")
	b.WriteString("SSH only. Never print passwords. Destructive ops blocked unless flagged; flagged ops ALWAYS ask user first.\n")
	b.WriteString("Flags: D=delete(ask) R=docker-restart(ask). reboot/shutdown always forbidden.\n")
	for _, s := range enabled {
		ok := "miss"
		if s.Reachable {
			ok = "ok"
		}
		flags := ""
		if s.AllowDelete {
			flags += "D"
		}
		if s.AllowDockerRestart {
			flags += "R"
		}
		if flags == "" {
			flags = "-"
		}
		b.WriteString(fmt.Sprintf("- #%d %s@%s:%d flags=%s cli=%s (%s)\n",
			s.ID, s.Username, s.Host, s.Port, flags, ok, s.Name))
	}
	return strings.TrimRight(b.String(), "\n")
}

func truncateStr(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n]
}
