import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import type { RelayDatabase } from '../db.js'
import { AUTH_ERROR_MESSAGE, jwtSecret, resolveClientIp } from './site.js'
import { getInstanceRow, isValidInstancePassword } from './instance.js'
import type { FailLockLimiter } from './failLock.js'
import {
  DEVICE_SESSION_TTL_SECONDS,
  createDeviceSession,
  hashUnlockToken,
  touchDeviceSession,
  verifyDeviceSession,
  type DeviceSessionRow,
} from './deviceSession.js'
import { consumeUnlockOtp } from './unlockOtp.js'

/** Unlock JWT lifetime (aligned with device session, 7d) */
export const UNLOCK_TTL_SECONDS = DEVICE_SESSION_TTL_SECONDS

/** Wrong password attempts before 5-minute lock */
export const UNLOCK_MAX_FAILURES = 5
export const UNLOCK_LOCK_MS = 5 * 60 * 1000

export const UNLOCK_LOCK_MESSAGE = '尝试次数过多，请 5 分钟后再试'

export type UnlockJwtPayload = {
  sub: 'instance_unlock'
  instance_id: string
  sid: string
}

export type UnlockRequest = Request & {
  unlockSession?: DeviceSessionRow
}

/** Issue unlock token scoped to one instance + device session id */
export function issueUnlockToken(instanceId: string, sessionId: string): string {
  const payload: UnlockJwtPayload = {
    sub: 'instance_unlock',
    instance_id: instanceId,
    sid: sessionId,
  }
  return jwt.sign(payload, jwtSecret(), { expiresIn: UNLOCK_TTL_SECONDS })
}

/** Decode unlock JWT without session DB check (returns null if invalid shape) */
export function decodeUnlockToken(token: string): UnlockJwtPayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret()) as UnlockJwtPayload
    if (payload.sub !== 'instance_unlock' || !payload.instance_id || !payload.sid) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

/** Verify unlock token matches expected instance and active device session */
export function verifyUnlockToken(
  db: RelayDatabase,
  token: string,
  instanceId: string,
  now = Date.now(),
): DeviceSessionRow | null {
  const payload = decodeUnlockToken(token)
  if (!payload || payload.instance_id !== instanceId) return null
  return verifyDeviceSession(db, payload.sid, instanceId, now)
}

/** Read X-Instance-Unlock header */
export function readUnlockHeader(req: Request): string | null {
  const raw = req.headers['x-instance-unlock']
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return null
}

export type UnlockResult =
  | {
      ok: true
      unlock_token: string
      expires_in: number
      session_id: string
    }
  | { ok: false; status: number; error: string }

export type UnlockMeta = {
  deviceLabel?: string
  userAgent?: string
  clientIp?: string
}

/** Verify Mac instance password and issue unlock JWT bound to a device session */
export function unlockInstance(
  db: RelayDatabase,
  failLock: FailLockLimiter,
  instanceId: string,
  password: string,
  ip: string,
  meta: UnlockMeta = {},
  now = Date.now(),
): UnlockResult {
  const lockKey = `unlock:${ip}:${instanceId}`
  if (failLock.isLocked(lockKey, now)) {
    return { ok: false, status: 429, error: UNLOCK_LOCK_MESSAGE }
  }

  const row = getInstanceRow(db, instanceId)
  let authed = false

  // 1) 固定 6 位实例密码
  if (isValidInstancePassword(password) && row?.password_hash) {
    const expired =
      row.password_expires_at != null && row.password_expires_at <= now
    if (!expired && bcrypt.compareSync(password, row.password_hash)) {
      authed = true
    }
  }

  // 2) 邮箱一次性验证码（6 位数字，用过即废，最长 7 天）
  if (!authed && consumeUnlockOtp(db, instanceId, password, now)) {
    authed = true
  }

  if (!authed) {
    const locked = failLock.recordFailure(lockKey, now)
    return {
      ok: false,
      status: locked ? 429 : 401,
      error: locked ? UNLOCK_LOCK_MESSAGE : AUTH_ERROR_MESSAGE,
    }
  }

  failLock.reset(lockKey)

  // Create session with placeholder hash, then issue JWT(sid) and store real hash.
  const placeholder = `pending:${now}:${Math.random().toString(36).slice(2)}`
  const session = createDeviceSession(db, {
    instanceId,
    unlockToken: placeholder,
    deviceLabel: meta.deviceLabel,
    userAgent: meta.userAgent,
    clientIp: meta.clientIp ?? ip,
    now,
  })
  const unlockToken = issueUnlockToken(instanceId, session.id)
  db.prepare(`UPDATE instance_device_sessions SET token_hash = ? WHERE id = ?`).run(
    hashUnlockToken(unlockToken),
    session.id,
  )

  return {
    ok: true,
    unlock_token: unlockToken,
    expires_in: UNLOCK_TTL_SECONDS,
    session_id: session.id,
  }
}

/** Factory: require unlock header + active device session for :id instance */
export function createRequireInstanceUnlock(db: RelayDatabase, paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const instanceId = String(req.params[paramName] || '').trim()
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const token = readUnlockHeader(req)
    if (!token) {
      res.status(403).json({ error: '需要先验证实例密码' })
      return
    }
    const session = verifyUnlockToken(db, token, instanceId)
    if (!session) {
      res.status(403).json({ error: '需要先验证实例密码' })
      return
    }
    const now = Date.now()
    if (now - session.last_seen_at >= 30_000) {
      touchDeviceSession(db, session.id, now)
    }
    ;(req as UnlockRequest).unlockSession = session
    next()
  }
}

/** Client IP for unlock rate limit */
export function unlockClientIp(req: Request): string {
  return resolveClientIp(req.ip, req.socket.remoteAddress)
}
