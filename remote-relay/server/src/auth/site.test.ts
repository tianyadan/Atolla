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

/** POST login with optional client IP override */
async function login(
  password: string,
  ip = '203.0.113.10',
): Promise<request.Response> {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ password })
}

beforeEach(() => {
  process.env.RELAY_JWT_SECRET = 'test-jwt-secret'
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

  it('locks out after consecutive failures', async () => {
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
})
