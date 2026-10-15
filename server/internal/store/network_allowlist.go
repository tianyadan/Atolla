package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// NetworkAllowlistRow is one domain/wildcard pattern in the platform allowlist.
type NetworkAllowlistRow struct {
	ID        int64     `json:"id"`
	Pattern   string    `json:"pattern"`
	Source    string    `json:"source"` // admin | agent
	AgentID   *int64    `json:"agent_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// EnsureNetworkAllowlistSchema creates table and seeds Amap defaults.
func (s *Store) EnsureNetworkAllowlistSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS network_allowlist (
		  id         BIGINT       NOT NULL AUTO_INCREMENT,
		  pattern    VARCHAR(255) NOT NULL,
		  source     VARCHAR(32)  NOT NULL DEFAULT 'admin',
		  agent_id   BIGINT       NULL,
		  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  UNIQUE KEY uk_network_pattern (pattern)
		) ENGINE=InnoDB`)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO network_allowlist (pattern, source) VALUES
		  ('restapi.amap.com', 'admin'),
		  ('*.amap.com', 'admin')
		ON DUPLICATE KEY UPDATE pattern = VALUES(pattern)`)
	return err
}

// ListNetworkAllowlist returns all patterns ordered by id.
func (s *Store) ListNetworkAllowlist(ctx context.Context) ([]NetworkAllowlistRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, pattern, source, agent_id, created_at
		FROM network_allowlist ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NetworkAllowlistRow
	for rows.Next() {
		var r NetworkAllowlistRow
		var agentID sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Pattern, &r.Source, &agentID, &r.CreatedAt); err != nil {
			return nil, err
		}
		if agentID.Valid {
			v := agentID.Int64
			r.AgentID = &v
		}
		out = append(out, r)
	}
	if out == nil {
		out = []NetworkAllowlistRow{}
	}
	return out, rows.Err()
}

// ListNetworkAllowlistPatterns returns only pattern strings.
func (s *Store) ListNetworkAllowlistPatterns(ctx context.Context) ([]string, error) {
	rows, err := s.ListNetworkAllowlist(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Pattern)
	}
	return out, nil
}

// ReplaceNetworkAllowlist replaces the full list (admin save).
func (s *Store) ReplaceNetworkAllowlist(ctx context.Context, patterns []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM network_allowlist`); err != nil {
		return err
	}
	ins, err := tx.PrepareContext(ctx, `
		INSERT INTO network_allowlist (pattern, source, agent_id) VALUES (?, 'admin', NULL)`)
	if err != nil {
		return err
	}
	defer ins.Close()
	seen := map[string]struct{}{}
	for _, p := range patterns {
		p = strings.TrimSpace(strings.ToLower(p))
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		if _, err := ins.ExecContext(ctx, p); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// UpsertNetworkAllowlistPattern inserts or keeps a pattern (agent confirm / admin add).
func (s *Store) UpsertNetworkAllowlistPattern(ctx context.Context, pattern, source string, agentID int64) error {
	pattern = strings.TrimSpace(strings.ToLower(pattern))
	if pattern == "" {
		return fmt.Errorf("pattern required")
	}
	source = strings.TrimSpace(source)
	if source == "" {
		source = "admin"
	}
	var agent any
	if agentID > 0 {
		agent = agentID
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO network_allowlist (pattern, source, agent_id) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE source = VALUES(source),
		  agent_id = COALESCE(VALUES(agent_id), agent_id)`,
		pattern, source, agent)
	return err
}
