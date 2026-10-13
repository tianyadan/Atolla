package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// DBSource is one configured database endpoint for an agent's database skill.
type DBSource struct {
	ID           int64     `json:"id"`
	AgentID      int64     `json:"agent_id"`
	Name         string    `json:"name"`
	DBType       string    `json:"db_type"` // mysql | pgsql | redis
	URL          string    `json:"url"`     // host:port or full URL without password
	DatabaseName string    `json:"database_name"`
	Username     string    `json:"username"`
	PasswordSet  bool      `json:"password_set"`
	PermList     bool      `json:"perm_list"`   // 列结构/键
	PermRead     bool      `json:"perm_read"`   // 查
	PermCreate   bool      `json:"perm_create"` // 增
	PermUpdate   bool      `json:"perm_update"` // 改
	PermDelete   bool      `json:"perm_delete"` // 删
	Enabled      bool      `json:"enabled"`
	ClientOK     bool      `json:"client_ok"` // filled by service (local CLI present)
	ClientBin    string    `json:"client_bin,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	PasswordEnc  string    `json:"-"`
}

// DBSourceInput is create/update payload (password optional on update).
type DBSourceInput struct {
	Name         string `json:"name"`
	DBType       string `json:"db_type"`
	URL          string `json:"url"`
	DatabaseName string `json:"database_name"`
	Username     string `json:"username"`
	Password     string `json:"password"` // plain; empty on update = keep
	ClearPassword bool  `json:"clear_password"`
	PermList     *bool  `json:"perm_list"`
	PermRead     *bool  `json:"perm_read"`
	PermCreate   *bool  `json:"perm_create"`
	PermUpdate   *bool  `json:"perm_update"`
	PermDelete   *bool  `json:"perm_delete"`
	Enabled      *bool  `json:"enabled"`
}

// EnsureDBSourceSchema creates agent_db_sources.
func (s *Store) EnsureDBSourceSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS agent_db_sources (
  id BIGINT NOT NULL AUTO_INCREMENT,
  agent_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL,
  db_type VARCHAR(16) NOT NULL,
  url VARCHAR(512) NOT NULL,
  database_name VARCHAR(128) NOT NULL DEFAULT '',
  username VARCHAR(128) NOT NULL DEFAULT '',
  password_enc TEXT NULL,
  perm_list TINYINT(1) NOT NULL DEFAULT 1,
  perm_read TINYINT(1) NOT NULL DEFAULT 1,
  perm_create TINYINT(1) NOT NULL DEFAULT 0,
  perm_update TINYINT(1) NOT NULL DEFAULT 0,
  perm_delete TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ads_agent (agent_id),
  CONSTRAINT fk_ads_agent FOREIGN KEY (agent_id) REFERENCES managed_agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

// ListDBSources returns datasources for an agent (no password plaintext).
func (s *Store) ListDBSources(ctx context.Context, agentID int64) ([]DBSource, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, agent_id, name, db_type, url, database_name, username,
       (password_enc IS NOT NULL AND password_enc <> '') AS pwd,
       perm_list, perm_read, perm_create, perm_update, perm_delete, enabled,
       created_at, updated_at
FROM agent_db_sources WHERE agent_id=? ORDER BY id ASC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DBSource
	for rows.Next() {
		src, err := scanDBSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, src)
	}
	return out, rows.Err()
}

// GetDBSource returns one datasource including password_enc for internal decrypt.
func (s *Store) GetDBSource(ctx context.Context, agentID, id int64) (DBSource, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, agent_id, name, db_type, url, database_name, username,
       COALESCE(password_enc,''),
       (password_enc IS NOT NULL AND password_enc <> '') AS pwd,
       perm_list, perm_read, perm_create, perm_update, perm_delete, enabled,
       created_at, updated_at
FROM agent_db_sources WHERE agent_id=? AND id=?`, agentID, id)
	var src DBSource
	var pl, pr, pc, pu, pd, en, pwd int
	err := row.Scan(
		&src.ID, &src.AgentID, &src.Name, &src.DBType, &src.URL, &src.DatabaseName, &src.Username,
		&src.PasswordEnc, &pwd,
		&pl, &pr, &pc, &pu, &pd, &en,
		&src.CreatedAt, &src.UpdatedAt,
	)
	if err != nil {
		return src, err
	}
	src.PasswordSet = pwd == 1
	src.PermList, src.PermRead, src.PermCreate, src.PermUpdate, src.PermDelete = pl == 1, pr == 1, pc == 1, pu == 1, pd == 1
	src.Enabled = en == 1
	return src, nil
}

func scanDBSource(rows *sql.Rows) (DBSource, error) {
	var src DBSource
	var pl, pr, pc, pu, pd, en, pwd int
	err := rows.Scan(
		&src.ID, &src.AgentID, &src.Name, &src.DBType, &src.URL, &src.DatabaseName, &src.Username,
		&pwd, &pl, &pr, &pc, &pu, &pd, &en, &src.CreatedAt, &src.UpdatedAt,
	)
	if err != nil {
		return src, err
	}
	src.PasswordSet = pwd == 1
	src.PermList, src.PermRead, src.PermCreate, src.PermUpdate, src.PermDelete = pl == 1, pr == 1, pc == 1, pu == 1, pd == 1
	src.Enabled = en == 1
	return src, nil
}

// CreateDBSource inserts a datasource (password_enc already encrypted by caller).
func (s *Store) CreateDBSource(ctx context.Context, agentID int64, in DBSourceInput, passwordEnc string) (DBSource, error) {
	name := strings.TrimSpace(in.Name)
	dbType := NormalizeDBType(in.DBType)
	url := strings.TrimSpace(in.URL)
	if name == "" || dbType == "" || url == "" {
		return DBSource{}, fmt.Errorf("name, db_type, url required")
	}
	pl, pr, pc, pu, pd := true, true, false, false, false
	if in.PermList != nil {
		pl = *in.PermList
	}
	if in.PermRead != nil {
		pr = *in.PermRead
	}
	if in.PermCreate != nil {
		pc = *in.PermCreate
	}
	if in.PermUpdate != nil {
		pu = *in.PermUpdate
	}
	if in.PermDelete != nil {
		pd = *in.PermDelete
	}
	res, err := s.db.ExecContext(ctx, `
INSERT INTO agent_db_sources
 (agent_id, name, db_type, url, database_name, username, password_enc,
  perm_list, perm_read, perm_create, perm_update, perm_delete, enabled)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
		agentID, name, dbType, url, strings.TrimSpace(in.DatabaseName), strings.TrimSpace(in.Username),
		nullIfEmpty(passwordEnc),
		bool01(pl), bool01(pr), bool01(pc), bool01(pu), bool01(pd),
	)
	if err != nil {
		return DBSource{}, err
	}
	id, _ := res.LastInsertId()
	return s.GetDBSource(ctx, agentID, id)
}

// UpdateDBSource patches a datasource. passEnc nil = keep; "" = clear; non-empty = set.
func (s *Store) UpdateDBSource(ctx context.Context, agentID, id int64, in DBSourceInput, passEnc *string) (DBSource, error) {
	cur, err := s.GetDBSource(ctx, agentID, id)
	if err != nil {
		return cur, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = cur.Name
	}
	dbType := NormalizeDBType(in.DBType)
	if dbType == "" {
		dbType = cur.DBType
	}
	url := strings.TrimSpace(in.URL)
	if url == "" {
		url = cur.URL
	}
	// Full-form updates (name/url present) replace optional text fields; partial perm-only patches keep them.
	full := strings.TrimSpace(in.Name) != "" || strings.TrimSpace(in.URL) != "" || strings.TrimSpace(in.DBType) != ""
	dbName := cur.DatabaseName
	user := cur.Username
	if full {
		dbName = strings.TrimSpace(in.DatabaseName)
		user = strings.TrimSpace(in.Username)
	}
	pl, pr, pc, pu, pd, en := cur.PermList, cur.PermRead, cur.PermCreate, cur.PermUpdate, cur.PermDelete, cur.Enabled
	if in.PermList != nil {
		pl = *in.PermList
	}
	if in.PermRead != nil {
		pr = *in.PermRead
	}
	if in.PermCreate != nil {
		pc = *in.PermCreate
	}
	if in.PermUpdate != nil {
		pu = *in.PermUpdate
	}
	if in.PermDelete != nil {
		pd = *in.PermDelete
	}
	if in.Enabled != nil {
		en = *in.Enabled
	}
	enc := cur.PasswordEnc
	if passEnc != nil {
		enc = *passEnc
	}
	_, err = s.db.ExecContext(ctx, `
UPDATE agent_db_sources SET name=?, db_type=?, url=?, database_name=?, username=?, password_enc=?,
 perm_list=?, perm_read=?, perm_create=?, perm_update=?, perm_delete=?, enabled=?
 WHERE agent_id=? AND id=?`,
		name, dbType, url, strings.TrimSpace(dbName), user, nullIfEmpty(enc),
		bool01(pl), bool01(pr), bool01(pc), bool01(pu), bool01(pd), bool01(en),
		agentID, id,
	)
	if err != nil {
		return cur, err
	}
	return s.GetDBSource(ctx, agentID, id)
}

// DeleteDBSource removes a datasource.
func (s *Store) DeleteDBSource(ctx context.Context, agentID, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM agent_db_sources WHERE agent_id=? AND id=?`, agentID, id)
	if err != nil {
		return err
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteAllDBSources removes all datasources for an agent (e.g. skill uninstall).
func (s *Store) DeleteAllDBSources(ctx context.Context, agentID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_db_sources WHERE agent_id=?`, agentID)
	return err
}

// NormalizeDBType maps aliases to a supported db_type id.
func NormalizeDBType(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "mysql":
		return "mysql"
	case "mariadb":
		return "mariadb"
	case "pgsql", "postgres", "postgresql":
		return "pgsql"
	case "redis":
		return "redis"
	case "mongodb", "mongo":
		return "mongodb"
	case "sqlite", "sqlite3":
		return "sqlite"
	case "clickhouse", "ch":
		return "clickhouse"
	case "elasticsearch", "es", "opensearch":
		return "elasticsearch"
	case "oracle":
		return "oracle"
	case "sqlserver", "mssql":
		return "sqlserver"
	default:
		return ""
	}
}

// DBSourcePermCode compact permission string e.g. "LRCUD".
func DBSourcePermCode(s DBSource) string {
	var b strings.Builder
	if s.PermList {
		b.WriteByte('L')
	}
	if s.PermRead {
		b.WriteByte('R')
	}
	if s.PermCreate {
		b.WriteByte('C')
	}
	if s.PermUpdate {
		b.WriteByte('U')
	}
	if s.PermDelete {
		b.WriteByte('D')
	}
	if b.Len() == 0 {
		return "-"
	}
	return b.String()
}

// FormatDBSourcesPromptCompact builds a minimal prompt block (no secrets).
func FormatDBSourcesPromptCompact(sources []DBSource) string {
	enabled := make([]DBSource, 0, len(sources))
	for _, s := range sources {
		if s.Enabled {
			enabled = append(enabled, s)
		}
	}
	if len(enabled) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## DB sources (compact)\n")
	b.WriteString("Use local CLI when cli=ok. Never print passwords. Respect perms (L=list R=read C=create U=update D=delete).\n")
	for _, s := range enabled {
		cli := "miss"
		if s.ClientOK {
			cli = "ok"
		}
		b.WriteString(fmt.Sprintf("- #%d %s %s", s.ID, s.DBType, s.URL))
		if s.DatabaseName != "" {
			b.WriteString("/" + s.DatabaseName)
		}
		if s.Username != "" {
			b.WriteString(" u=" + s.Username)
		}
		b.WriteString(" perms=" + DBSourcePermCode(s))
		b.WriteString(" cli=" + cli)
		if s.Name != "" {
			b.WriteString(" (" + s.Name + ")")
		}
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}
