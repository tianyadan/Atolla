import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../app.js'
import { initDb, type RelayDatabase } from '../db.js'

const SITE_PASSWORD = 'secret-gate-pass'
const BCRYPT_ROUNDS = 12

let dbPath: string
let db: RelayDatabase
let app: Express

/** POST login with optional X-Forwarded-For (only affects IP when RELAY_TRUST_PROXY=1) */
async function login(
  password: string,
  forwardedFor?: string,
): Promise<request.Response> {
  const req = request(app).post('/api/auth/login')
  if (forwardedFor) req.set('X-Forwarded-For', forwardedFor)
  return req.send({ password })
}

beforeEach(() => {
  process.env.RELAY_JWT_SECRET = 'test-jwt-secret'
  delete process.env.RELAY_TRUST_PROXY
  delete process.env.NODE_ENV
  dbPath = path.join(os.tmpdir(), `relay-auth-test-${Date.now()}.db`)
  db = initDb(dbPath)
  const hash = bcrypt.hashSync(SITE_PASSWORD, BCRYPT_ROUNDS)
  const now = Date.now()
  db.prepare(
    `INSERT INTO site_auth (id, password_hash, token_version, failed_attempt_count, locked_until, updated_at)
     VALUES (1, ?, 1, 0, NULL, ?)`,
  ).run(hash, now)
  app = createApp(db)
})

afterEach(() => {
  db.close()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  delete process.env.RELAY_JWT_SECRET
  delete process.env.RELAY_TRUST_PROXY
  delete process.env.NODE_ENV
})

describe('site gate auth', () => {
  it('rejects bad password', async () => {
    const r = await login('wrong')
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('账号或密码错误')
    expect(r.body.token).toBeUndefined()
  })

  it('issues JWT with token_version on success', async () => {
    const r = await login(SITE_PASSWORD)
    expect(r.status).toBe(200)
    expect(typeof r.body.token).toBe('string')

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${r.body.token}`)
    expect(me.status).toBe(200)
    expect(me.body.tokenVersion).toBe(1)
  })

  it('throttles login after five attempts per minute from same IP', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await login('wrong')
      expect(r.status).toBe(401)
    }
    const throttled = await login('wrong')
    expect(throttled.status).toBe(401)
    expect(throttled.body.error).toBe('账号或密码错误')

    const ok = await login(SITE_PASSWORD)
    expect(ok.status).toBe(401)
  })

  it('ignores spoofed X-Forwarded-For when trust proxy is off', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await login('wrong', `203.0.113.${i + 1}`)
      expect(r.status).toBe(401)
    }
    const throttled = await login('wrong', '203.0.113.99')
    expect(throttled.status).toBe(401)
  })

  it('locks out after consecutive failures', async () => {
    process.env.RELAY_TRUST_PROXY = '1'
    app = createApp(db)
    const ip = '198.51.100.7'
    for (let i = 0; i < 5; i += 1) {
      const r = await login('wrong', ip)
      expect(r.status).toBe(401)
      expect(r.body.error).toBe('账号或密码错误')
    }
    const locked = await login(SITE_PASSWORD, ip)
    expect(locked.status).toBe(401)
    expect(locked.body.error).toBe('账号或密码错误')

    const row = db
      .prepare('SELECT locked_until FROM site_auth WHERE id = 1')
      .get() as { locked_until: number | null }
    expect(row.locked_until).not.toBeNull()
    expect(row.locked_until!).toBeGreaterThan(Date.now())
  })

  it('requires RELAY_JWT_SECRET in production', async () => {
    delete process.env.RELAY_JWT_SECRET
    process.env.NODE_ENV = 'production'
    const { validateSiteAuthConfig, jwtSecret } = await import('./site.js')
    expect(() => validateSiteAuthConfig()).toThrow(/RELAY_JWT_SECRET/)
    expect(() => jwtSecret()).toThrow(/RELAY_JWT_SECRET/)
  })
})
