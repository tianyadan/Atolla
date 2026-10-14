import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import type { RelayDatabase } from '../db.js'
import { AUTH_ERROR_MESSAGE, jwtSecret, resolveClientIp } from './site.js'
import { getInstanceRow, isValidInstancePassword } from './instance.js'
import type { FailLockLimiter } from './failLock.js'

/** Unlock JWT lifetime (24h) */
export const UNLOCK_TTL_SECONDS = 24 * 3600

/** Wrong password attempts before 5-minute lock */
export const UNLOCK_MAX_FAILURES = 5
export const UNLOCK_LOCK_MS = 5 * 60 * 1000

export const UNLOCK_LOCK_MESSAGE = '尝试次数过多，请 5 分钟后再试'

export type UnlockJwtPayload = {
  sub: 'instance_unlock'
  instance_id: string
}

/** Issue unlock token scoped to one instance */
export function issueUnlockToken(instanceId: string): string {
  const payload: UnlockJwtPayload = { sub: 'instance_unlock', instance_id: instanceId }
  return jwt.sign(payload, jwtSecret(), { expiresIn: UNLOCK_TTL_SECONDS })
}

/** Verify unlock token matches expected instance */
export function verifyUnlockToken(token: string, instanceId: string): boolean {
  try {
    const payload = jwt.verify(token, jwtSecret()) as UnlockJwtPayload
    return payload.sub === 'instance_unlock' && payload.instance_id === instanceId
  } catch {
    return false
  }
}

/** Read X-Instance-Unlock header */
export function readUnlockHeader(req: Request): string | null {
  const raw = req.headers['x-instance-unlock']
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return null
}

export type UnlockResult =
  | { ok: true; unlock_token: string; expires_in: number }
  | { ok: false; status: number; error: string }

/** Verify Mac instance password and issue unlock JWT (site gate already required) */
export function unlockInstance(
  db: RelayDatabase,
  failLock: FailLockLimiter,
  instanceId: string,
  password: string,
  ip: string,
  now = Date.now(),
): UnlockResult {
  const lockKey = `unlock:${ip}:${instanceId}`
  if (failLock.isLocked(lockKey, now)) {
    return { ok: false, status: 429, error: UNLOCK_LOCK_MESSAGE }
  }

  if (!isValidInstancePassword(password)) {
    const locked = failLock.recordFailure(lockKey, now)
    return {
      ok: false,
      status: locked ? 429 : 401,
      error: locked ? UNLOCK_LOCK_MESSAGE : AUTH_ERROR_MESSAGE,
    }
  }

  const row = getInstanceRow(db, instanceId)
  if (!row?.password_hash) {
    const locked = failLock.recordFailure(lockKey, now)
    return {
      ok: false,
      status: locked ? 429 : 401,
      error: locked ? UNLOCK_LOCK_MESSAGE : AUTH_ERROR_MESSAGE,
    }
  }
  if (row.password_expires_at != null && row.password_expires_at <= now) {
    const locked = failLock.recordFailure(lockKey, now)
    return {
      ok: false,
      status: locked ? 429 : 401,
      error: locked ? UNLOCK_LOCK_MESSAGE : AUTH_ERROR_MESSAGE,
    }
  }

  if (!bcrypt.compareSync(password, row.password_hash)) {
    const locked = failLock.recordFailure(lockKey, now)
    return {
      ok: false,
      status: locked ? 429 : 401,
      error: locked ? UNLOCK_LOCK_MESSAGE : AUTH_ERROR_MESSAGE,
    }
  }

  failLock.reset(lockKey)
  return {
    ok: true,
    unlock_token: issueUnlockToken(instanceId),
    expires_in: UNLOCK_TTL_SECONDS,
  }
}

/** Require site JWT already applied; also require unlock token for this instance path param */
export function requireInstanceUnlock(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const instanceId = String(req.params[paramName] || '').trim()
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const token = readUnlockHeader(req)
    if (!token || !verifyUnlockToken(token, instanceId)) {
      res.status(403).json({ error: '需要先验证实例密码' })
      return
    }
    next()
  }
}

/** Client IP for unlock rate limit */
export function unlockClientIp(req: Request): string {
  return resolveClientIp(req.ip, req.socket.remoteAddress)
}
