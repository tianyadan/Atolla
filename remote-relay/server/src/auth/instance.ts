import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import type { RelayDatabase } from '../db.js'
import type { LoginRateLimiter } from './rateLimit.js'
import { resolveClientIp } from './site.js'
import { revokeAllDeviceSessions } from './deviceSession.js'

const BCRYPT_ROUNDS = 12
/** Lower cost on open register path to limit event-loop DoS (verify uses stored hash rounds) */
const REGISTER_BCRYPT_ROUNDS = 10

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
  host_meta_json?: string
  created_at: number
  updated_at: number
}

/** Host metrics pushed by Mac on heartbeat */
export type InstanceHostMeta = {
  os?: string
  ip?: string
  uptime_sec?: number
  cpu_pct?: number
  mem_pct?: number
  disk_pct?: number
  /** Representative host temperature in °C (optional) */
  temp_c?: number
}

export type RegisterInput = {
  instance_id: string
  display_name: string
  password: string
  registry_version: number
  actions: string[]
}

export type RegisterContext = {
  /** Client IP for audit (optional) */
  ip?: string
  /** Prior instance password from X-Instance-* headers (required to rotate an existing password) */
  priorCredentials?: { instanceId: string; password: string } | null
  /** X-Relay-Bootstrap-Token when RELAY_INSTANCE_BOOTSTRAP_TOKEN is configured */
  bootstrapToken?: string | null
}

/** Whether new instance registration requires RELAY_INSTANCE_BOOTSTRAP_TOKEN */
export function instanceBootstrapTokenConfigured(): boolean {
  return Boolean(process.env.RELAY_INSTANCE_BOOTSTRAP_TOKEN?.trim())
}

/** Validate optional bootstrap token for first-time instance registration */
export function verifyInstanceBootstrapToken(token: string | undefined | null): boolean {
  const expected = process.env.RELAY_INSTANCE_BOOTSTRAP_TOKEN?.trim()
  if (!expected) return true
  const got = token?.trim()
  return got === expected
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

/** Hash password on register (capped rounds) */
export function hashInstancePasswordForRegister(plain: string): string {
  return bcrypt.hashSync(plain, REGISTER_BCRYPT_ROUNDS)
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
  ctx: RegisterContext = {},
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

  const existing = getInstanceRow(db, input.instance_id)
  if (!existing) {
    if (!verifyInstanceBootstrapToken(ctx.bootstrapToken)) {
      return { ok: false, status: 403, error: 'Unauthorized' }
    }
  } else if (existing.password_hash) {
    const prior = ctx.priorCredentials
    // 过期口令仍可用旧密码轮换，否则 7 天后「轮换并重新注册」会被 401 卡死。
    if (
      !prior ||
      prior.instanceId !== input.instance_id ||
      !bcrypt.compareSync(prior.password, existing.password_hash)
    ) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
  }

  const passwordHash = hashInstancePasswordForRegister(input.password)
  const expiresAt = now + INSTANCE_PASSWORD_TTL_MS
  const actionsJson = JSON.stringify(input.actions)

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

/** Record a failed instance auth attempt toward IP + instance throttle */
function recordInstanceAuthRateLimitFailure(
  rateLimiter: LoginRateLimiter,
  limitKey: string,
  db: RelayDatabase,
  instanceId: string,
  ip: string,
  now: number,
): void {
  rateLimiter.recordAttempt(limitKey, now)
  recordInstanceAuthFailure(db, instanceId, ip, now)
}

/** Verify instance password; rate-limit only failed attempts by IP + instance */
export function authenticateInstance(
  db: RelayDatabase,
  rateLimiter: LoginRateLimiter,
  instanceId: string,
  password: string,
  ip: string,
  now = Date.now(),
): InstanceAuthContext | null {
  const limitKey = instanceAuthRateLimitKey(ip, instanceId)
  if (rateLimiter.isThrottled(limitKey, now)) {
    return null
  }

  const row = getInstanceRow(db, instanceId)
  if (!row?.password_hash) {
    recordInstanceAuthRateLimitFailure(rateLimiter, limitKey, db, instanceId, ip, now)
    return null
  }

  if (row.password_expires_at != null && row.password_expires_at <= now) {
    recordInstanceAuthRateLimitFailure(rateLimiter, limitKey, db, instanceId, ip, now)
    return null
  }

  const valid = bcrypt.compareSync(password, row.password_hash)
  if (!valid) {
    recordInstanceAuthRateLimitFailure(rateLimiter, limitKey, db, instanceId, ip, now)
    return null
  }

  return { instanceId, row }
}

export type InstanceAuthedRequest = Request & {
  instanceAuth: InstanceAuthContext
}

/** Express middleware: require valid instance credentials (for heartbeat and future routes) */
export function requireInstanceAuth(
  db: RelayDatabase,
  rateLimiter: LoginRateLimiter,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const creds = parseInstanceCredentials(req)
    if (!creds) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const ip = instanceClientIp(req)
    const auth = authenticateInstance(
      db,
      rateLimiter,
      creds.instanceId,
      creds.password,
      ip,
    )
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    ;(req as InstanceAuthedRequest).instanceAuth = auth
    next()
  }
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

/** Update heartbeat timestamp, optional registry metadata, and host metrics */
export function recordHeartbeat(
  db: RelayDatabase,
  instanceId: string,
  opts: {
    registry_version?: number
    actions?: string[]
    host?: InstanceHostMeta | null
    unlock_otp_smtp_ok?: boolean
  },
  now = Date.now(),
): void {
  const hostJson =
    opts.host && typeof opts.host === 'object' ? JSON.stringify(opts.host) : null
  const smtpOk =
    typeof opts.unlock_otp_smtp_ok === 'boolean'
      ? opts.unlock_otp_smtp_ok
        ? 1
        : 0
      : null

  if (opts.actions != null) {
    if (hostJson) {
      db.prepare(
        `UPDATE instances
         SET last_heartbeat_at = ?, status = 'healthy', actions_json = ?,
             registry_version = COALESCE(?, registry_version),
             host_meta_json = ?,
             unlock_otp_smtp_ok = COALESCE(?, unlock_otp_smtp_ok),
             updated_at = ?
         WHERE instance_id = ?`,
      ).run(
        now,
        JSON.stringify(opts.actions),
        opts.registry_version ?? null,
        hostJson,
        smtpOk,
        now,
        instanceId,
      )
      return
    }
    db.prepare(
      `UPDATE instances
       SET last_heartbeat_at = ?, status = 'healthy', actions_json = ?,
           registry_version = COALESCE(?, registry_version),
           unlock_otp_smtp_ok = COALESCE(?, unlock_otp_smtp_ok),
           updated_at = ?
       WHERE instance_id = ?`,
    ).run(
      now,
      JSON.stringify(opts.actions),
      opts.registry_version ?? null,
      smtpOk,
      now,
      instanceId,
    )
    return
  }

  if (hostJson) {
    db.prepare(
      `UPDATE instances
       SET last_heartbeat_at = ?, status = 'healthy',
           registry_version = COALESCE(?, registry_version),
           host_meta_json = ?,
           unlock_otp_smtp_ok = COALESCE(?, unlock_otp_smtp_ok),
           updated_at = ?
       WHERE instance_id = ?`,
    ).run(now, opts.registry_version ?? null, hostJson, smtpOk, now, instanceId)
    return
  }

  db.prepare(
    `UPDATE instances
     SET last_heartbeat_at = ?, status = 'healthy',
         registry_version = COALESCE(?, registry_version),
         unlock_otp_smtp_ok = COALESCE(?, unlock_otp_smtp_ok),
         updated_at = ?
     WHERE instance_id = ?`,
  ).run(now, opts.registry_version ?? null, smtpOk, now, instanceId)
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

  revokeAllDeviceSessions(db, instanceId, now)

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
  host: InstanceHostMeta
  unlock_otp_smtp_ok: boolean
}> {
  const rows = db
    .prepare(
      `SELECT instance_id, display_name, last_heartbeat_at, status,
              registry_version, actions_json, password_expires_at, password_hash,
              IFNULL(host_meta_json, '{}') AS host_meta_json,
              IFNULL(unlock_otp_smtp_ok, 0) AS unlock_otp_smtp_ok
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
      | 'host_meta_json'
    > & { unlock_otp_smtp_ok: number }
  >

  return rows.map((row) => {
    let host: InstanceHostMeta = {}
    try {
      host = JSON.parse(row.host_meta_json || '{}') as InstanceHostMeta
    } catch {
      host = {}
    }
    return {
      instance_id: row.instance_id,
      display_name: row.display_name,
      last_heartbeat_at: row.last_heartbeat_at,
      status: row.status,
      registry_version: row.registry_version,
      actions: JSON.parse(row.actions_json) as string[],
      password_expires_at: row.password_expires_at,
      has_password: row.password_hash != null,
      host,
      unlock_otp_smtp_ok: Number(row.unlock_otp_smtp_ok) === 1,
    }
  })
}

/** Resolve client IP for instance routes */
export function instanceClientIp(req: Request): string {
  return resolveClientIp(req.ip, req.socket.remoteAddress)
}
