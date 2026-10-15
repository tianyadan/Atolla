import { createHash, randomUUID } from 'node:crypto'
import type { RelayDatabase } from '../db.js'

/** Unlock session lifetime (7 days) */
export const DEVICE_SESSION_TTL_SECONDS = 7 * 24 * 3600
export const DEVICE_SESSION_TTL_MS = DEVICE_SESSION_TTL_SECONDS * 1000

/** Online if last_seen within this window */
export const DEVICE_ONLINE_MS = 90_000

/** Sliding renew when remaining lifetime below this */
export const DEVICE_SESSION_RENEW_IF_REMAINING_MS = 3 * 24 * 3600 * 1000

export type DeviceSessionRow = {
  id: string
  instance_id: string
  token_hash: string
  device_label: string
  user_agent: string
  client_ip: string
  created_at: number
  expires_at: number
  last_seen_at: number
  revoked_at: number | null
}

export type PublicDeviceSession = {
  session_id: string
  device_label: string
  user_agent: string
  client_ip: string
  created_at: number
  expires_at: number
  last_seen_at: number
  online: boolean
  revoked: boolean
}

/** SHA-256 hex of unlock token */
export function hashUnlockToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export type CreateDeviceSessionInput = {
  instanceId: string
  unlockToken: string
  deviceLabel?: string
  userAgent?: string
  clientIp?: string
  now?: number
}

/** Insert a new device session row for an issued unlock token */
export function createDeviceSession(
  db: RelayDatabase,
  input: CreateDeviceSessionInput,
): DeviceSessionRow {
  const now = input.now ?? Date.now()
  const id = randomUUID()
  const row: DeviceSessionRow = {
    id,
    instance_id: input.instanceId,
    token_hash: hashUnlockToken(input.unlockToken),
    device_label: (input.deviceLabel || 'Mobile').trim().slice(0, 64) || 'Mobile',
    user_agent: (input.userAgent || '').trim().slice(0, 512),
    client_ip: (input.clientIp || '').trim().slice(0, 128),
    created_at: now,
    expires_at: now + DEVICE_SESSION_TTL_MS,
    last_seen_at: now,
    revoked_at: null,
  }
  db.prepare(
    `INSERT INTO instance_device_sessions
      (id, instance_id, token_hash, device_label, user_agent, client_ip,
       created_at, expires_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    row.id,
    row.instance_id,
    row.token_hash,
    row.device_label,
    row.user_agent,
    row.client_ip,
    row.created_at,
    row.expires_at,
    row.last_seen_at,
  )
  // Same phone re-unlock: revoke older sessions with matching fingerprint.
  revokeSiblingDeviceSessions(db, row, now)
  return row
}

/** Revoke other active sessions that look like the same physical device */
export function revokeSiblingDeviceSessions(
  db: RelayDatabase,
  row: DeviceSessionRow,
  now = Date.now(),
): number {
  const result = db
    .prepare(
      `UPDATE instance_device_sessions
       SET revoked_at = ?
       WHERE instance_id = ?
         AND id != ?
         AND revoked_at IS NULL
         AND lower(device_label) = lower(?)
         AND substr(lower(user_agent), 1, 120) = substr(lower(?), 1, 120)
         AND lower(client_ip) = lower(?)`,
    )
    .run(now, row.instance_id, row.id, row.device_label, row.user_agent, row.client_ip)
  return result.changes
}

/** Load session by id */
export function getDeviceSession(
  db: RelayDatabase,
  sessionId: string,
): DeviceSessionRow | null {
  const row = db
    .prepare(
      `SELECT id, instance_id, token_hash, device_label, user_agent, client_ip,
              created_at, expires_at, last_seen_at, revoked_at
       FROM instance_device_sessions WHERE id = ?`,
    )
    .get(sessionId) as DeviceSessionRow | undefined
  return row ?? null
}

/** Whether session is usable for unlock auth */
export function isDeviceSessionActive(
  row: DeviceSessionRow,
  now = Date.now(),
): boolean {
  if (row.revoked_at != null) return false
  if (row.expires_at <= now) return false
  return true
}

/** Verify sid belongs to instance and is active */
export function verifyDeviceSession(
  db: RelayDatabase,
  sessionId: string,
  instanceId: string,
  now = Date.now(),
): DeviceSessionRow | null {
  const row = getDeviceSession(db, sessionId)
  if (!row || row.instance_id !== instanceId) return null
  if (!isDeviceSessionActive(row, now)) return null
  return row
}

/** Touch last_seen; optionally slide expires_at when remaining &lt; 3d */
export function touchDeviceSession(
  db: RelayDatabase,
  sessionId: string,
  now = Date.now(),
): DeviceSessionRow | null {
  const row = getDeviceSession(db, sessionId)
  if (!row || !isDeviceSessionActive(row, now)) return null
  let expiresAt = row.expires_at
  if (expiresAt - now < DEVICE_SESSION_RENEW_IF_REMAINING_MS) {
    expiresAt = now + DEVICE_SESSION_TTL_MS
  }
  db.prepare(
    `UPDATE instance_device_sessions
     SET last_seen_at = ?, expires_at = ?
     WHERE id = ?`,
  ).run(now, expiresAt, sessionId)
  return { ...row, last_seen_at: now, expires_at: expiresAt }
}

/** Revoke one session (logout / kick) */
export function revokeDeviceSession(
  db: RelayDatabase,
  sessionId: string,
  instanceId: string,
  now = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE instance_device_sessions
       SET revoked_at = ?
       WHERE id = ? AND instance_id = ? AND revoked_at IS NULL`,
    )
    .run(now, sessionId, instanceId)
  return result.changes > 0
}

/** Revoke all sessions for an instance (password revoke) */
export function revokeAllDeviceSessions(
  db: RelayDatabase,
  instanceId: string,
  now = Date.now(),
): number {
  const result = db
    .prepare(
      `UPDATE instance_device_sessions
       SET revoked_at = ?
       WHERE instance_id = ? AND revoked_at IS NULL`,
    )
    .run(now, instanceId)
  return result.changes
}

/**
 * List sessions for Mac / admin UI.
 * Only non-revoked sessions (kicked/logged-out rows are hidden so re-login does not show duplicates).
 * Deduplicate by device fingerprint (label + UA + IP), keep the most recently seen.
 */
export function listDeviceSessions(
  db: RelayDatabase,
  instanceId: string,
  now = Date.now(),
): PublicDeviceSession[] {
  const rows = db
    .prepare(
      `SELECT id, instance_id, token_hash, device_label, user_agent, client_ip,
              created_at, expires_at, last_seen_at, revoked_at
       FROM instance_device_sessions
       WHERE instance_id = ? AND revoked_at IS NULL
       ORDER BY last_seen_at DESC
       LIMIT 50`,
    )
    .all(instanceId) as DeviceSessionRow[]

  const seen = new Set<string>()
  const out: PublicDeviceSession[] = []
  for (const r of rows) {
    const fp = [
      (r.device_label || '').toLowerCase(),
      (r.user_agent || '').slice(0, 120).toLowerCase(),
      (r.client_ip || '').toLowerCase(),
    ].join('|')
    if (seen.has(fp)) continue
    seen.add(fp)
    out.push({
      session_id: r.id,
      device_label: r.device_label,
      user_agent: r.user_agent,
      client_ip: r.client_ip,
      created_at: r.created_at,
      expires_at: r.expires_at,
      last_seen_at: r.last_seen_at,
      revoked: false,
      online: r.expires_at > now && now - r.last_seen_at <= DEVICE_ONLINE_MS,
    })
  }
  return out
}
