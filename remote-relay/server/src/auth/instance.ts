import bcrypt from 'bcryptjs'
import type { Request } from 'express'
import type { RelayDatabase } from '../db.js'
import type { LoginRateLimiter } from './rateLimit.js'
import { resolveClientIp } from './site.js'

const BCRYPT_ROUNDS = 12

/** Instance password lifetime after register (ms) */
export const INSTANCE_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Mac-generated 6-char alphanumeric password */
export const INSTANCE_PASSWORD_PATTERN = /^[0-9A-Za-z]{6}$/

export type InstanceRow = {
  instance_id: string
  display_name: string
  password_hash: string | null
  password_expires_at: number | null
  last_heartbeat_at: number | null
  status: string
  registry_version: number
  actions_json: string
  created_at: number
  updated_at: number
}

export type RegisterInput = {
  instance_id: string
  display_name: string
  password: string
  registry_version: number
  actions: string[]
}

export type InstanceAuthContext = {
  instanceId: string
  row: InstanceRow
}

/** Build rate-limit key for instance auth failures (IP + instance) */
export function instanceAuthRateLimitKey(ip: string, instanceId: string): string {
  return `${ip}::${instanceId}`
}

/** Validate Mac-side 6-char password format */
export function isValidInstancePassword(password: string): boolean {
  return INSTANCE_PASSWORD_PATTERN.test(password)
}

/** Hash instance password for storage */
export function hashInstancePassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS)
}

/** Load instance row by id */
export function getInstanceRow(
  db: RelayDatabase,
  instanceId: string,
): InstanceRow | undefined {
  return db
    .prepare(`SELECT * FROM instances WHERE instance_id = ?`)
    .get(instanceId) as InstanceRow | undefined
}

/** Register or rotate password for an instance (server never generates password) */
export function registerInstance(
  db: RelayDatabase,
  input: RegisterInput,
  now = Date.now(),
): { ok: true } | { ok: false; status: number; error: string } {
  if (!input.instance_id.trim() || !input.display_name.trim()) {
    return { ok: false, status: 400, error: 'Invalid register payload' }
  }
  if (!isValidInstancePassword(input.password)) {
    return { ok: false, status: 400, error: 'Invalid instance password' }
  }
  if (!Number.isInteger(input.registry_version) || input.registry_version < 1) {
    return { ok: false, status: 400, error: 'Invalid registry_version' }
  }
  if (!Array.isArray(input.actions) || input.actions.some((a) => typeof a !== 'string')) {
    return { ok: false, status: 400, error: 'Invalid actions' }
  }

  const passwordHash = hashInstancePassword(input.password)
  const expiresAt = now + INSTANCE_PASSWORD_TTL_MS
  const actionsJson = JSON.stringify(input.actions)

  const existing = getInstanceRow(db, input.instance_id)
  if (existing) {
    db.prepare(
      `UPDATE instances
       SET display_name = ?, password_hash = ?, password_expires_at = ?,
           registry_version = ?, actions_json = ?, status = 'healthy',
           last_heartbeat_at = ?, updated_at = ?
       WHERE instance_id = ?`,
    ).run(
      input.display_name,
      passwordHash,
      expiresAt,
      input.registry_version,
      actionsJson,
      now,
      now,
      input.instance_id,
    )
  } else {
    db.prepare(
      `INSERT INTO instances (
         instance_id, display_name, password_hash, password_expires_at,
         last_heartbeat_at, status, registry_version, actions_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'healthy', ?, ?, ?, ?)`,
    ).run(
      input.instance_id,
      input.display_name,
      passwordHash,
      expiresAt,
      now,
      input.registry_version,
      actionsJson,
      now,
      now,
    )
  }

  db.prepare(
    `INSERT INTO audit_logs (event_type, instance_id, meta_json, created_at)
     VALUES ('instance_register', ?, '{}', ?)`,
  ).run(input.instance_id, now)

  return { ok: true }
}

/** Parse instance credentials from headers (custom or Basic) */
export function parseInstanceCredentials(req: Request): {
  instanceId: string
  password: string
} | null {
  const headerId = req.headers['x-instance-id']
  const headerPass = req.headers['x-instance-password']
  if (typeof headerId === 'string' && typeof headerPass === 'string') {
    const instanceId = headerId.trim()
    const password = headerPass.trim()
    if (instanceId && password) return { instanceId, password }
  }

  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string') {
    const basic = /^Basic\s+(.+)$/i.exec(authHeader)
    if (basic?.[1]) {
      try {
        const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
        const colon = decoded.indexOf(':')
        if (colon > 0) {
          const instanceId = decoded.slice(0, colon)
          const password = decoded.slice(colon + 1)
          if (instanceId && password) return { instanceId, password }
        }
      } catch {
        return null
      }
    }
  }

  return null
}

/** Verify instance password; rate-limit failures by IP + instance */
export function authenticateInstance(
  db: RelayDatabase,
  rateLimiter: LoginRateLimiter,
  instanceId: string,
  password: string,
  ip: string,
  now = Date.now(),
): InstanceAuthContext | null {
  const limitKey = instanceAuthRateLimitKey(ip, instanceId)
  if (!rateLimiter.recordAttempt(limitKey, now)) {
    return null
  }

  const row = getInstanceRow(db, instanceId)
  if (!row?.password_hash) {
    recordInstanceAuthFailure(db, instanceId, ip, now)
    return null
  }

  if (row.password_expires_at != null && row.password_expires_at <= now) {
    recordInstanceAuthFailure(db, instanceId, ip, now)
    return null
  }

  const valid = bcrypt.compareSync(password, row.password_hash)
  if (!valid) {
    recordInstanceAuthFailure(db, instanceId, ip, now)
    return null
  }

  return { instanceId, row }
}

/** Audit failed instance authentication */
function recordInstanceAuthFailure(
  db: RelayDatabase,
  instanceId: string,
  ip: string,
  now: number,
): void {
  db.prepare(
    `INSERT INTO audit_logs (event_type, instance_id, ip, meta_json, created_at)
     VALUES ('instance_auth_failed', ?, ?, '{}', ?)`,
  ).run(instanceId, ip, now)
}

/** Update heartbeat timestamp and optional registry metadata */
export function recordHeartbeat(
  db: RelayDatabase,
  instanceId: string,
  opts: { registry_version?: number; actions?: string[] },
  now = Date.now(),
): void {
  if (opts.actions != null) {
    db.prepare(
      `UPDATE instances
       SET last_heartbeat_at = ?, status = 'healthy', actions_json = ?,
           registry_version = COALESCE(?, registry_version), updated_at = ?
       WHERE instance_id = ?`,
    ).run(
      now,
      JSON.stringify(opts.actions),
      opts.registry_version ?? null,
      now,
      instanceId,
    )
    return
  }

  db.prepare(
    `UPDATE instances
     SET last_heartbeat_at = ?, status = 'healthy',
         registry_version = COALESCE(?, registry_version), updated_at = ?
     WHERE instance_id = ?`,
  ).run(now, opts.registry_version ?? null, now, instanceId)
}

/** Revoke instance password (clear hash so auth fails immediately) */
export function revokeInstancePassword(
  db: RelayDatabase,
  instanceId: string,
  now = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE instances
       SET password_hash = NULL, password_expires_at = NULL, status = 'revoked', updated_at = ?
       WHERE instance_id = ?`,
    )
    .run(now, instanceId)
  if (result.changes === 0) return false

  db.prepare(
    `INSERT INTO audit_logs (event_type, instance_id, meta_json, created_at)
     VALUES ('instance_password_revoked', ?, '{}', ?)`,
  ).run(instanceId, now)
  return true
}

/** Public instance summary for site UI (no secrets) */
export function listInstancesPublic(db: RelayDatabase): Array<{
  instance_id: string
  display_name: string
  last_heartbeat_at: number | null
  status: string
  registry_version: number
  actions: string[]
  password_expires_at: number | null
  has_password: boolean
}> {
  const rows = db
    .prepare(
      `SELECT instance_id, display_name, last_heartbeat_at, status,
              registry_version, actions_json, password_expires_at, password_hash
       FROM instances ORDER BY display_name COLLATE NOCASE`,
    )
    .all() as Array<
    Pick<
      InstanceRow,
      | 'instance_id'
      | 'display_name'
      | 'last_heartbeat_at'
      | 'status'
      | 'registry_version'
      | 'actions_json'
      | 'password_expires_at'
      | 'password_hash'
    >
  >

  return rows.map((row) => ({
    instance_id: row.instance_id,
    display_name: row.display_name,
    last_heartbeat_at: row.last_heartbeat_at,
    status: row.status,
    registry_version: row.registry_version,
    actions: JSON.parse(row.actions_json) as string[],
    password_expires_at: row.password_expires_at,
    has_password: row.password_hash != null,
  }))
}

/** Resolve client IP for instance routes */
export function instanceClientIp(req: Request): string {
  return resolveClientIp(req.ip, req.socket.remoteAddress)
}
