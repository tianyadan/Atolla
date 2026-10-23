import { randomInt, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { RelayDatabase } from '../db.js'
import { enqueueAndWait } from '../commands.js'
import { getInstanceRow } from './instance.js'

/** OTP 最长有效 7 天；用过即废 */
export const UNLOCK_OTP_TTL_MS = 7 * 24 * 60 * 60 * 1000
const OTP_BCRYPT_ROUNDS = 10
/** 同一实例发码最短间隔（仅成功发信后生效） */
export const UNLOCK_OTP_SEND_COOLDOWN_MS = 60_000
/** 等待 Mac SMTP 发信 */
const SEND_WAIT_MS = 45_000

export type UnlockOtpStatus = {
  ready: boolean
  smtp_ok: boolean
  receive_email_set: boolean
  receive_email_masked: string
}

/** 读取站点接收邮箱 */
export function getSiteReceiveEmail(db: RelayDatabase): string {
  const row = db
    .prepare(`SELECT IFNULL(receive_email, '') AS receive_email FROM site_auth WHERE id = 1`)
    .get() as { receive_email: string } | undefined
  return String(row?.receive_email || '').trim()
}

/** 保存站点接收邮箱（空字符串表示清除） */
export function setSiteReceiveEmail(db: RelayDatabase, email: string): void {
  const now = Date.now()
  const value = String(email || '').trim().toLowerCase()
  db.prepare(
    `UPDATE site_auth SET receive_email = ?, updated_at = ? WHERE id = 1`,
  ).run(value, now)
}

/** 简单邮箱格式 */
export function isValidReceiveEmail(email: string): boolean {
  const e = String(email || '').trim()
  if (e.length < 5 || e.length > 200) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

/** 脱敏显示 */
export function maskEmail(email: string): string {
  const e = String(email || '').trim()
  const at = e.indexOf('@')
  if (at <= 1) return e ? '***' : ''
  return `${e[0]}***${e.slice(at)}`
}

/** 实例是否上报 SMTP 可用 */
export function instanceSmtpOk(db: RelayDatabase, instanceId: string): boolean {
  const row = db
    .prepare(
      `SELECT IFNULL(unlock_otp_smtp_ok, 0) AS unlock_otp_smtp_ok
       FROM instances WHERE instance_id = ?`,
    )
    .get(instanceId) as { unlock_otp_smtp_ok: number } | undefined
  return Number(row?.unlock_otp_smtp_ok) === 1
}

/** 心跳写入 SMTP 就绪标记 */
export function setInstanceSmtpOk(
  db: RelayDatabase,
  instanceId: string,
  ok: boolean,
  now = Date.now(),
): void {
  db.prepare(
    `UPDATE instances SET unlock_otp_smtp_ok = ?, updated_at = ? WHERE instance_id = ?`,
  ).run(ok ? 1 : 0, now, instanceId)
}

/** 验证码登录能力（SMTP + 收件邮箱） */
export function getUnlockOtpStatus(
  db: RelayDatabase,
  instanceId: string,
): UnlockOtpStatus {
  const receive = getSiteReceiveEmail(db)
  const smtpOk = instanceSmtpOk(db, instanceId)
  const receiveSet = receive.length > 0
  return {
    ready: smtpOk && receiveSet,
    smtp_ok: smtpOk,
    receive_email_set: receiveSet,
    receive_email_masked: maskEmail(receive),
  }
}

/** 生成 6 位数字码 */
export function generateUnlockOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

type SendResult =
  | { ok: true; expires_in: number }
  | { ok: false; status: number; error: string }

/** 最近一次发信命令是否成功（用于冷却：失败不挡重试） */
function lastUnlockOtpCommandOk(db: RelayDatabase, instanceId: string): boolean | null {
  const row = db
    .prepare(
      `SELECT status FROM commands
       WHERE instance_id = ? AND action_type = 'instance.send_unlock_otp'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(instanceId) as { status: string } | undefined
  if (!row) return null
  return row.status === 'done'
}

/** 创建 OTP、等 Mac 真正发信成功；失败删码不占冷却 */
export async function sendUnlockOtp(
  db: RelayDatabase,
  instanceId: string,
  now = Date.now(),
): Promise<SendResult> {
  if (!getInstanceRow(db, instanceId)) {
    return { ok: false, status: 404, error: 'Instance not found' }
  }
  const status = getUnlockOtpStatus(db, instanceId)
  if (!status.ready) {
    return {
      ok: false,
      status: 400,
      error: !status.smtp_ok
        ? 'Mac 尚未配置或校验通过发送邮箱 SMTP'
        : '请先在设置中填写接收邮箱',
    }
  }

  const last = db
    .prepare(
      `SELECT created_at FROM instance_unlock_otps
       WHERE instance_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(instanceId) as { created_at: number } | undefined
  if (last && now - last.created_at < UNLOCK_OTP_SEND_COOLDOWN_MS) {
    const prevOk = lastUnlockOtpCommandOk(db, instanceId)
    if (prevOk === true) {
      const waitSec = Math.ceil((UNLOCK_OTP_SEND_COOLDOWN_MS - (now - last.created_at)) / 1000)
      return {
        ok: false,
        status: 429,
        error: `发送过于频繁，请 ${waitSec} 秒后再试`,
      }
    }
    // 上次未成功（失败/超时/排队中途）：清掉未使用码，允许重试
    db.prepare(
      `DELETE FROM instance_unlock_otps
       WHERE instance_id = ? AND used_at IS NULL AND created_at >= ?`,
    ).run(instanceId, last.created_at)
  }

  const code = generateUnlockOtpCode()
  const expiresAt = now + UNLOCK_OTP_TTL_MS
  const id = randomUUID()
  const codeHash = bcrypt.hashSync(code, OTP_BCRYPT_ROUNDS)
  db.prepare(
    `INSERT INTO instance_unlock_otps
     (id, instance_id, code_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(id, instanceId, codeHash, expiresAt, now)

  const to = getSiteReceiveEmail(db)
  const wait = await enqueueAndWait(
    db,
    instanceId,
    'instance.send_unlock_otp',
    {
      to_email: to,
      code,
      expires_at: expiresAt,
      otp_id: id,
    },
    SEND_WAIT_MS,
  )
  if (!wait.ok) {
    db.prepare(`DELETE FROM instance_unlock_otps WHERE id = ?`).run(id)
    return {
      ok: false,
      status: wait.httpStatus,
      error: wait.error || 'Mac 发信失败',
    }
  }

  return { ok: true, expires_in: Math.floor(UNLOCK_OTP_TTL_MS / 1000) }
}

/** 校验并消费未过期 OTP；成功返回 true */
export function consumeUnlockOtp(
  db: RelayDatabase,
  instanceId: string,
  code: string,
  now = Date.now(),
): boolean {
  const plain = String(code || '').trim()
  if (!/^\d{6}$/.test(plain)) return false

  const rows = db
    .prepare(
      `SELECT id, code_hash, expires_at FROM instance_unlock_otps
       WHERE instance_id = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 5`,
    )
    .all(instanceId, now) as Array<{ id: string; code_hash: string; expires_at: number }>

  for (const row of rows) {
    if (!bcrypt.compareSync(plain, row.code_hash)) continue
    const updated = db
      .prepare(
        `UPDATE instance_unlock_otps SET used_at = ?
         WHERE id = ? AND used_at IS NULL`,
      )
      .run(now, row.id)
    if (updated.changes > 0) return true
  }
  return false
}
