package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Legacy memory section keys (dismiss checklist).
const (
	LegacySecProfile     = "profile"
	LegacySecProjects    = "projects"
	LegacySecCredentials = "credentials"
	LegacySecDatabase    = "database"
	LegacySecServers     = "servers"
	LegacySecDocs        = "docs"
	LegacySecHabits      = "habits"
	LegacySecOpenItems   = "open_items"
	LegacySecSkills      = "skills"
)

// AllLegacyMemorySections returns default-selected sections.
func AllLegacyMemorySections() []string {
	return []string{
		LegacySecProfile, LegacySecProjects, LegacySecCredentials,
		LegacySecDatabase, LegacySecServers, LegacySecDocs,
		LegacySecHabits, LegacySecOpenItems, LegacySecSkills,
	}
}

// LegacyMemory is a dismiss-generated memory book.
type LegacyMemory struct {
	ID              int64     `json:"id"`
	SourceAgentID   int64     `json:"source_agent_id"`
	AgentName       string    `json:"agent_name"`
	JobTitle        string    `json:"job_title"`
	AvatarURL       string    `json:"avatar_url"`
	Engine          string    `json:"engine"`
	SectionsJSON    string    `json:"sections_json"`
	Sections        []string  `json:"sections,omitempty"`
	BodyMarkdown    string    `json:"body_markdown"`
	MaterialsJSON   string    `json:"materials_json,omitempty"`
	Status          string    `json:"status"` // generating | ready | failed | claimed
	ErrorMessage    string    `json:"error_message,omitempty"`
	ClaimedByAgent  int64     `json:"claimed_by_agent_id,omitempty"`
	ClaimedAt       *time.Time `json:"claimed_at,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// AgentLegacyMemoryMount records a one-time inheritance on an agent.
type AgentLegacyMemoryMount struct {
	ID               int64     `json:"id"`
	AgentID          int64     `json:"agent_id"`
	LegacyMemoryID   int64     `json:"legacy_memory_id"`
	SourceAgentName  string    `json:"source_agent_name"`
	SourceJobTitle   string    `json:"source_job_title"`
	SourceAvatarURL  string    `json:"source_avatar_url"`
	MountedAt        time.Time `json:"mounted_at"`
}

// EnsureLegacyMemorySchema creates tables for dismiss memory books.
func (s *Store) EnsureLegacyMemorySchema(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS legacy_memories (
  id BIGINT NOT NULL AUTO_INCREMENT,
  source_agent_id BIGINT NOT NULL DEFAULT 0,
  agent_name VARCHAR(128) NOT NULL DEFAULT '',
  job_title VARCHAR(128) NOT NULL DEFAULT '数字员工',
  avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  engine VARCHAR(32) NOT NULL DEFAULT '',
  sections_json JSON NOT NULL,
  body_markdown LONGTEXT NOT NULL,
  materials_json LONGTEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'generating',
  error_message VARCHAR(512) NOT NULL DEFAULT '',
  claimed_by_agent_id BIGINT NULL,
  claimed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_lm_status (status, created_at),
  KEY idx_lm_source (source_agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS agent_legacy_memory_mounts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  agent_id BIGINT NOT NULL,
  legacy_memory_id BIGINT NOT NULL,
  source_agent_name VARCHAR(128) NOT NULL DEFAULT '',
  source_job_title VARCHAR(128) NOT NULL DEFAULT '',
  source_avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  mounted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_alm_mem (legacy_memory_id),
  KEY idx_alm_agent (agent_id),
  CONSTRAINT fk_alm_agent FOREIGN KEY (agent_id) REFERENCES managed_agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

func decodeLegacySections(raw string) []string {
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	if out == nil {
		out = []string{}
	}
	return out
}

func scanLegacyMemory(scanner interface{ Scan(dest ...any) error }) (LegacyMemory, error) {
	var m LegacyMemory
	var claimedAt sql.NullTime
	var claimedBy sql.NullInt64
	var mats sql.NullString
	err := scanner.Scan(
		&m.ID, &m.SourceAgentID, &m.AgentName, &m.JobTitle, &m.AvatarURL, &m.Engine,
		&m.SectionsJSON, &m.BodyMarkdown, &mats, &m.Status, &m.ErrorMessage,
		&claimedBy, &claimedAt, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return m, err
	}
	if mats.Valid {
		m.MaterialsJSON = mats.String
	}
	m.Sections = decodeLegacySections(m.SectionsJSON)
	if claimedBy.Valid {
		m.ClaimedByAgent = claimedBy.Int64
	}
	if claimedAt.Valid {
		t := claimedAt.Time
		m.ClaimedAt = &t
	}
	return m, nil
}

const legacyMemorySelect = `id, source_agent_id, agent_name, job_title, avatar_url, engine,
 CAST(sections_json AS CHAR), body_markdown, materials_json, status, error_message,
 claimed_by_agent_id, claimed_at, created_at, updated_at`

// InsertLegacyMemory creates a generating/ready book row.
func (s *Store) InsertLegacyMemory(ctx context.Context, m *LegacyMemory) (int64, error) {
	sec := m.SectionsJSON
	if strings.TrimSpace(sec) == "" {
		b, _ := json.Marshal(m.Sections)
		sec = string(b)
	}
	if strings.TrimSpace(sec) == "" {
		sec = "[]"
	}
	body := m.BodyMarkdown
	if body == "" {
		body = ""
	}
	mats := m.MaterialsJSON
	res, err := s.db.ExecContext(ctx, `
INSERT INTO legacy_memories
 (source_agent_id, agent_name, job_title, avatar_url, engine, sections_json, body_markdown, materials_json, status, error_message)
VALUES (?,?,?,?,?,CAST(? AS JSON),?,?,?,?)`,
		m.SourceAgentID, m.AgentName, m.JobTitle, m.AvatarURL, m.Engine,
		sec, body, nullIfEmpty(mats), m.Status, m.ErrorMessage)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateLegacyMemoryBodyStatus sets generated body/status.
func (s *Store) UpdateLegacyMemoryBodyStatus(ctx context.Context, id int64, body, status, errMsg string) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE legacy_memories SET body_markdown=?, status=?, error_message=? WHERE id=?`,
		body, status, errMsg, id)
	return err
}

// UpdateLegacyMemoryBody edits book content (admin).
func (s *Store) UpdateLegacyMemoryBody(ctx context.Context, id int64, body, jobTitle string) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE legacy_memories SET body_markdown=?, job_title=COALESCE(NULLIF(?,''), job_title) WHERE id=? AND status IN ('ready','failed')`,
		body, jobTitle, id)
	return err
}

// GetLegacyMemory returns one book.
func (s *Store) GetLegacyMemory(ctx context.Context, id int64) (*LegacyMemory, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+legacyMemorySelect+` FROM legacy_memories WHERE id=?`, id)
	m, err := scanLegacyMemory(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ListLegacyMemoriesShelf lists books visible on the shelf (not claimed).
func (s *Store) ListLegacyMemoriesShelf(ctx context.Context) ([]LegacyMemory, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT `+legacyMemorySelect+` FROM legacy_memories
 WHERE status IN ('generating','ready','failed')
 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LegacyMemory
	for rows.Next() {
		m, err := scanLegacyMemory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MarkLegacyMemoryClaimed marks book claimed by agent.
func (s *Store) MarkLegacyMemoryClaimed(ctx context.Context, id, agentID int64) error {
	res, err := s.db.ExecContext(ctx, `
UPDATE legacy_memories SET status='claimed', claimed_by_agent_id=?, claimed_at=NOW(3)
 WHERE id=? AND status='ready' AND claimed_by_agent_id IS NULL`, agentID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("memory not available for claim")
	}
	return nil
}

// CountAgentLegacyMounts returns how many memories an agent has mounted.
func (s *Store) CountAgentLegacyMounts(ctx context.Context, agentID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_legacy_memory_mounts WHERE agent_id=?`, agentID).Scan(&n)
	return n, err
}

// InsertAgentLegacyMemoryMount records inheritance metadata for settings UI.
func (s *Store) InsertAgentLegacyMemoryMount(ctx context.Context, m AgentLegacyMemoryMount) (int64, error) {
	res, err := s.db.ExecContext(ctx, `
INSERT INTO agent_legacy_memory_mounts
 (agent_id, legacy_memory_id, source_agent_name, source_job_title, source_avatar_url)
VALUES (?,?,?,?,?)`,
		m.AgentID, m.LegacyMemoryID, m.SourceAgentName, m.SourceJobTitle, m.SourceAvatarURL)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ListAgentLegacyMemoryMounts lists mounts for settings.
func (s *Store) ListAgentLegacyMemoryMounts(ctx context.Context, agentID int64) ([]AgentLegacyMemoryMount, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, agent_id, legacy_memory_id, source_agent_name, source_job_title, source_avatar_url, mounted_at
 FROM agent_legacy_memory_mounts WHERE agent_id=? ORDER BY mounted_at DESC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentLegacyMemoryMount
	for rows.Next() {
		var m AgentLegacyMemoryMount
		if err := rows.Scan(&m.ID, &m.AgentID, &m.LegacyMemoryID, &m.SourceAgentName, &m.SourceJobTitle, &m.SourceAvatarURL, &m.MountedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// AppendManagedAgentRulesPrompt appends text to rules_prompt.
func (s *Store) AppendManagedAgentRulesPrompt(ctx context.Context, id int64, block string) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE managed_agents SET rules_prompt=CONCAT(IFNULL(rules_prompt,''), ?) WHERE id=?`, block, id)
	return err
}
