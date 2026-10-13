package store

import (
	"context"
	"time"
)

// AutoApproveAudit records a command auto-approved without human review.
type AutoApproveAudit struct {
	ID             int64     `json:"id"`
	AgentID        int64     `json:"agent_id"`
	ConversationID int64     `json:"conversation_id"`
	ToolName       string    `json:"tool_name"`
	CommandText    string    `json:"command_text"`
	Reason         string    `json:"reason"`
	CreatedAt      time.Time `json:"created_at"`
}

// EnsureAutoApproveSchema creates auto_approve_audits + managed_agents.auto_approve_all.
func (s *Store) EnsureAutoApproveSchema(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS auto_approve_audits (
  id BIGINT NOT NULL AUTO_INCREMENT,
  agent_id BIGINT NOT NULL DEFAULT 0,
  conversation_id BIGINT NOT NULL DEFAULT 0,
  tool_name VARCHAR(64) NOT NULL DEFAULT '',
  command_text TEXT NOT NULL,
  reason VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_aaa_created (created_at),
  KEY idx_aaa_agent (agent_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'managed_agents' AND COLUMN_NAME = 'auto_approve_all'`,
	).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE managed_agents ADD COLUMN auto_approve_all TINYINT NOT NULL DEFAULT 0 AFTER auto_review`); err != nil {
			return err
		}
	}
	return nil
}

// InsertAutoApproveAudit stores one auto-approved command.
func (s *Store) InsertAutoApproveAudit(ctx context.Context, agentID, convID int64, tool, cmd, reason string) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO auto_approve_audits (agent_id, conversation_id, tool_name, command_text, reason)
VALUES (?,?,?,?,?)`, agentID, convID, tool, cmd, reason)
	return err
}

// PurgeAutoApproveAuditsOlderThan deletes audits older than cutoff.
func (s *Store) PurgeAutoApproveAuditsOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM auto_approve_audits WHERE created_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// AgentSkillIconBrief is a compact skill icon for UI hover.
type AgentSkillIconBrief struct {
	ID      string `json:"id"`
	IconKey string `json:"icon_key"`
	IconURL string `json:"icon_url,omitempty"`
	Name    string `json:"name"`
}

// ListAgentSkillIcons returns installed+enabled skill icons for one agent.
func (s *Store) ListAgentSkillIcons(ctx context.Context, agentID int64) ([]AgentSkillIconBrief, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT c.id, c.icon_key, COALESCE(c.icon_url,''), c.name
FROM agent_skill_installs i
JOIN skill_catalog c ON c.id = i.skill_id
WHERE i.agent_id=? AND i.enabled=1 AND c.enabled=1
ORDER BY c.category ASC, c.name ASC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentSkillIconBrief
	for rows.Next() {
		var it AgentSkillIconBrief
		if err := rows.Scan(&it.ID, &it.IconKey, &it.IconURL, &it.Name); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// CountInstalledSkillsMap returns agent_id -> installed enabled skill count.
func (s *Store) CountInstalledSkillsMap(ctx context.Context) (map[int64]int, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT agent_id, COUNT(*) FROM agent_skill_installs WHERE enabled=1 GROUP BY agent_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// ListInstalledSkillIconsByAgents returns icons keyed by agent id.
func (s *Store) ListInstalledSkillIconsByAgents(ctx context.Context) (map[int64][]AgentSkillIconBrief, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT i.agent_id, c.id, c.icon_key, COALESCE(c.icon_url,''), c.name
FROM agent_skill_installs i
JOIN skill_catalog c ON c.id = i.skill_id
WHERE i.enabled=1 AND c.enabled=1
ORDER BY i.agent_id ASC, c.category ASC, c.name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]AgentSkillIconBrief{}
	for rows.Next() {
		var agentID int64
		var it AgentSkillIconBrief
		if err := rows.Scan(&agentID, &it.ID, &it.IconKey, &it.IconURL, &it.Name); err != nil {
			return nil, err
		}
		out[agentID] = append(out[agentID], it)
	}
	return out, rows.Err()
}
