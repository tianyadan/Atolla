import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const BCRYPT_ROUNDS = 12

/** SQLite schema version for future migrations */
export const SCHEMA_VERSION = 1

export type RelayDatabase = Database.Database

/** Resolve SQLite file path from env or default under server/data */
export function resolveDbPath(): string {
  const fromEnv = process.env.SQLITE_PATH?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd(), 'data', 'relay.db')
}

/** Create tables aligned with design spec §7 */
function applySchema(db: RelayDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      failed_attempt_count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instances (
      instance_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      password_expires_at INTEGER,
      last_heartbeat_at INTEGER,
      status TEXT NOT NULL DEFAULT 'unknown',
      registry_version INTEGER NOT NULL DEFAULT 1,
      actions_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      leased_until INTEGER,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
    );

    CREATE INDEX IF NOT EXISTS idx_commands_instance_status
      ON commands(instance_id, status, created_at);

    CREATE TABLE IF NOT EXISTS agents_mirror (
      instance_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      display_name TEXT,
      engine TEXT,
      status TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (instance_id, agent_id),
      FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
    );

    CREATE TABLE IF NOT EXISTS tasks_mirror (
      instance_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (instance_id, agent_id, task_id),
      FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
    );

    CREATE TABLE IF NOT EXISTS messages_mirror (
      instance_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT,
      content TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (instance_id, message_id),
      FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_mirror_agent
      ON messages_mirror(instance_id, agent_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS permissions_mirror (
      instance_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL DEFAULT 0,
      tool_name TEXT,
      summary TEXT,
      note TEXT,
      meaning TEXT,
      risk TEXT,
      created_at TEXT,
      deadline TEXT,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (instance_id, request_id),
      FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
    );

    CREATE INDEX IF NOT EXISTS idx_permissions_mirror_agent
      ON permissions_mirror(instance_id, agent_id, synced_at DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      instance_id TEXT,
      ip TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created
      ON audit_logs(created_at DESC);
  `)

  // Optional host metrics JSON from Mac heartbeat (os/ip/uptime/cpu/mem/disk).
  try {
    db.exec(`ALTER TABLE instances ADD COLUMN host_meta_json TEXT NOT NULL DEFAULT '{}'`)
  } catch {
    /* column already exists */
  }

  // Phone chat presence (which agent mobile is viewing); returned on Mac heartbeat.
  try {
    db.exec(`ALTER TABLE instances ADD COLUMN mobile_viewing_agent_id TEXT`)
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE instances ADD COLUMN mobile_viewing_at INTEGER`)
  } catch {
    /* column already exists */
  }
}

/** Bootstrap / sync site gate password from SITE_PASSWORD */
function bootstrapSiteAuth(db: RelayDatabase): void {
  const plain = process.env.SITE_PASSWORD?.trim()
  const row = db
    .prepare('SELECT id, password_hash, token_version FROM site_auth WHERE id = 1')
    .get() as { id: number; password_hash: string; token_version: number } | undefined

  if (!row) {
    if (!plain) {
      console.warn(
        '[remote-relay] site_auth empty and SITE_PASSWORD unset; set SITE_PASSWORD on first boot',
      )
      return
    }
    const passwordHash = bcrypt.hashSync(plain, BCRYPT_ROUNDS)
    const now = Date.now()
    db.prepare(
      `INSERT INTO site_auth (id, password_hash, token_version, failed_attempt_count, locked_until, updated_at)
       VALUES (1, ?, 1, 0, NULL, ?)`,
    ).run(passwordHash, now)
    delete process.env.SITE_PASSWORD
    return
  }

  // 本机调试：若设置了 SITE_PASSWORD 且与库内不一致，同步更新（避免旧库卡死在 testpass）
  const isDev = (process.env.NODE_ENV || 'development') !== 'production'
  if (isDev && plain && !bcrypt.compareSync(plain, row.password_hash)) {
    const passwordHash = bcrypt.hashSync(plain, BCRYPT_ROUNDS)
    const now = Date.now()
    const nextVer = (Number(row.token_version) || 1) + 1
    db.prepare(
      `UPDATE site_auth
       SET password_hash = ?, token_version = ?, failed_attempt_count = 0, locked_until = NULL, updated_at = ?
       WHERE id = 1`,
    ).run(passwordHash, nextVer, now)
    console.log('[remote-relay] site gate password synced from SITE_PASSWORD (dev)')
  }

  delete process.env.SITE_PASSWORD
}

/** Open SQLite, apply schema, and bootstrap site auth if needed */
export function initDb(dbPath?: string): RelayDatabase {
  const resolved = dbPath ?? resolveDbPath()
  fs.mkdirSync(path.dirname(resolved), { recursive: true })

  const db = new Database(resolved)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  bootstrapSiteAuth(db)
  return db
}
