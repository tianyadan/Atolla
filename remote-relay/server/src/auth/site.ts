import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { RelayDatabase } from '../db.js'
import type { LoginRateLimiter } from './rateLimit.js'

export const AUTH_ERROR_MESSAGE = '账号或密码错误'

/** Consecutive failures before site gate lockout */
export const MAX_CONSECUTIVE_FAILURES = 5

/** Lockout duration after too many consecutive failures (ms) */
export const LOCKOUT_MS = 15 * 60 * 1000

/** Default JWT lifetime (hours) */
const DEFAULT_JWT_TTL_HOURS = 24

export type SiteAuthRow = {
  password_hash: string
  token_version: number
  failed_attempt_count: number
  locked_until: number | null
}

export type SiteJwtPayload = {
  sub: 'site'
  token_version: number
}

const DEV_JWT_SECRET = 'relay-dev-jwt-secret-change-me'

/** Whether Express should trust proxy headers for req.ip (set RELAY_TRUST_PROXY=1 behind a real reverse proxy) */
export function isRelayTrustProxyEnabled(): boolean {
  const v = process.env.RELAY_TRUST_PROXY?.trim()
  return v === '1' || v?.toLowerCase() === 'true'
}

/** Normalize Express/socket IP (strip IPv6-mapped IPv4 prefix) */
function normalizeIp(ip: string | undefined): string | undefined {
  const trimmed = ip?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7)
  return trimmed
}

/**
 * Resolve client IP for rate limit / audit.
 * Never reads raw X-Forwarded-For; use req.ip only when RELAY_TRUST_PROXY is enabled (Express trust proxy).
 */
export function resolveClientIp(
  expressIp: string | undefined,
  socketIp: string | undefined,
): string {
  if (isRelayTrustProxyEnabled()) {
    return normalizeIp(expressIp) ?? normalizeIp(socketIp) ?? '127.0.0.1'
  }
  return normalizeIp(socketIp) ?? '127.0.0.1'
}

/** Fail fast at startup when production has no signing secret */
export function validateSiteAuthConfig(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.RELAY_JWT_SECRET?.trim()) {
    throw new Error('RELAY_JWT_SECRET is required when NODE_ENV=production')
  }
}

/** HS256 secret from env; dev/test fallback only outside production */
export function jwtSecret(): string {
  const fromEnv = process.env.RELAY_JWT_SECRET?.trim()
  if (fromEnv) return fromEnv
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RELAY_JWT_SECRET is required when NODE_ENV=production')
  }
  return DEV_JWT_SECRET
}

/** JWT TTL in seconds */
function jwtTtlSeconds(): number {
  const raw = process.env.RELAY_JWT_TTL_HOURS?.trim()
  const hours = raw ? Number(raw) : DEFAULT_JWT_TTL_HOURS
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_JWT_TTL_HOURS * 3600
  return hours * 3600
}

/** Load singleton site_auth row */
export function getSiteAuthRow(db: RelayDatabase): SiteAuthRow | undefined {
  return db
    .prepare(
      `SELECT password_hash, token_version, failed_attempt_count, locked_until
       FROM site_auth WHERE id = 1`,
    )
    .get() as SiteAuthRow | undefined
}

/** Issue signed site gate JWT embedding current token_version */
export function issueSiteToken(tokenVersion: number): string {
  const payload: SiteJwtPayload = { sub: 'site', token_version: tokenVersion }
  return jwt.sign(payload, jwtSecret(), { expiresIn: jwtTtlSeconds() })
}

/** Verify bearer token and ensure token_version matches DB */
export function verifySiteToken(
  db: RelayDatabase,
  token: string,
): SiteJwtPayload | null {
  try {
    const decoded = jwt.verify(token, jwtSecret()) as SiteJwtPayload
    if (decoded.sub !== 'site') return null
    const row = getSiteAuthRow(db)
    if (!row || row.token_version !== decoded.token_version) return null
    return decoded
  } catch {
    return null
  }
}

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; status: 401; error: string }

/** Attempt site login with bcrypt, lockout, and IP rate limit */
export function loginSite(
  db: RelayDatabase,
  rateLimiter: LoginRateLimiter,
  password: string,
  ip: string,
  now = Date.now(),
): LoginResult {
  if (!rateLimiter.recordAttempt(ip, now)) {
    return { ok: false, status: 401, error: AUTH_ERROR_MESSAGE }
  }

  const row = getSiteAuthRow(db)
  if (!row) {
    return { ok: false, status: 401, error: AUTH_ERROR_MESSAGE }
  }

  if (row.locked_until != null && row.locked_until > now) {
    return { ok: false, status: 401, error: AUTH_ERROR_MESSAGE }
  }

  if (row.locked_until != null && row.locked_until <= now) {
    db.prepare(
      `UPDATE site_auth SET failed_attempt_count = 0, locked_until = NULL, updated_at = ? WHERE id = 1`,
    ).run(now)
    row.failed_attempt_count = 0
    row.locked_until = null
  }

  const valid = bcrypt.compareSync(password, row.password_hash)
  if (!valid) {
    const nextFailures = row.failed_attempt_count + 1
    let lockedUntil: number | null = null
    if (nextFailures >= MAX_CONSECUTIVE_FAILURES) {
      lockedUntil = now + LOCKOUT_MS
    }
    db.prepare(
      `UPDATE site_auth
       SET failed_attempt_count = ?, locked_until = ?, updated_at = ?
       WHERE id = 1`,
    ).run(nextFailures, lockedUntil, now)
    db.prepare(
      `INSERT INTO audit_logs (event_type, ip, meta_json, created_at)
       VALUES ('site_login_failed', ?, '{}', ?)`,
    ).run(ip, now)
    return { ok: false, status: 401, error: AUTH_ERROR_MESSAGE }
  }

  db.prepare(
    `UPDATE site_auth
     SET failed_attempt_count = 0, locked_until = NULL, updated_at = ?
     WHERE id = 1`,
  ).run(now)

  const token = issueSiteToken(row.token_version)
  return { ok: true, token }
}
