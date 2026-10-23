import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, type RelayDatabase } from '../db.js'
import {
  consumeUnlockOtp,
  generateUnlockOtpCode,
  getUnlockOtpStatus,
  isValidReceiveEmail,
  maskEmail,
  setInstanceSmtpOk,
  setSiteReceiveEmail,
} from './unlockOtp.js'

let dbPath: string
let db: RelayDatabase

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `relay-otp-${Date.now()}.db`)
  db = initDb(dbPath)
  const now = Date.now()
  db.prepare(
    `INSERT INTO site_auth (id, password_hash, token_version, failed_attempt_count, locked_until, updated_at)
     VALUES (1, 'x', 1, 0, NULL, ?)`,
  ).run(now)
  db.prepare(
    `INSERT INTO instances (instance_id, display_name, status, registry_version, actions_json, created_at, updated_at)
     VALUES ('mac-1', 'Mac', 'online', 1, '[]', ?, ?)`,
  ).run(now, now)
})

afterEach(() => {
  db.close()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
})

describe('unlockOtp helpers', () => {
  it('masks and validates email', () => {
    expect(isValidReceiveEmail('a@b.co')).toBe(true)
    expect(isValidReceiveEmail('bad')).toBe(false)
    expect(maskEmail('alice@example.com')).toBe('a***@example.com')
  })

  it('generates 6-digit codes', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateUnlockOtpCode()).toMatch(/^\d{6}$/)
    }
  })

  it('ready only when smtp_ok and receive email set', () => {
    expect(getUnlockOtpStatus(db, 'mac-1').ready).toBe(false)
    setInstanceSmtpOk(db, 'mac-1', true)
    expect(getUnlockOtpStatus(db, 'mac-1').ready).toBe(false)
    setSiteReceiveEmail(db, 'user@example.com')
    const st = getUnlockOtpStatus(db, 'mac-1')
    expect(st.ready).toBe(true)
    expect(st.receive_email_masked).toMatch(/@example\.com$/)
  })

  it('consume is single-use', () => {
    const now = Date.now()
    const hash = bcrypt.hashSync('123456', 4)
    db.prepare(
      `INSERT INTO instance_unlock_otps (id, instance_id, code_hash, expires_at, used_at, created_at)
       VALUES ('otp1', 'mac-1', ?, ?, NULL, ?)`,
    ).run(hash, now + 60_000, now)

    expect(consumeUnlockOtp(db, 'mac-1', '123456', now)).toBe(true)
    expect(consumeUnlockOtp(db, 'mac-1', '123456', now)).toBe(false)
  })
})
