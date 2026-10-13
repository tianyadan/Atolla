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
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const INSTANCE_ID = 'mac-office-1'
const DISPLAY_NAME = 'Office-Mac'
const PASSWORD = 'Ab12Cd'
const ACTIONS = ['ping', 'sync.agents', 'sync.tasks', 'sync.messages']

let dbPath: string
let db: RelayDatabase
let app: Express

/** Site JWT for protected instance admin routes */
async function siteToken(): Promise<string> {
  const r = await request(app)
    .post('/api/auth/login')
    .send({ password: SITE_PASSWORD })
  expect(r.status).toBe(200)
  return r.body.token as string
}

/** Register instance with Mac-generated password */
async function register(
  overrides: Partial<{
    instance_id: string
    display_name: string
    password: string
    registry_version: number
    actions: string[]
  }> = {},
): Promise<request.Response> {
  return request(app)
    .post('/api/device/register')
    .send({
      instance_id: INSTANCE_ID,
      display_name: DISPLAY_NAME,
      password: PASSWORD,
      registry_version: 1,
      actions: ACTIONS,
      ...overrides,
    })
}

/** Heartbeat with instance headers */
function heartbeat(
  instanceId: string,
  password: string,
  body: Record<string, unknown> = {},
): request.Test {
  return request(app)
    .post('/api/device/heartbeat')
    .set('X-Instance-Id', instanceId)
    .set('X-Instance-Password', password)
    .send(body)
}

beforeEach(() => {
  process.env.RELAY_JWT_SECRET = 'test-jwt-secret'
  delete process.env.RELAY_TRUST_PROXY
  delete process.env.NODE_ENV
  dbPath = path.join(os.tmpdir(), `relay-instance-test-${Date.now()}.db`)
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

describe('instance register / heartbeat / revoke', () => {
  it('register stores bcrypt hash and 7-day expiry', async () => {
    const now = Date.now()
    const r = await register()
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)

    const row = db
      .prepare(
        `SELECT password_hash, password_expires_at, display_name, actions_json
         FROM instances WHERE instance_id = ?`,
      )
      .get(INSTANCE_ID) as {
      password_hash: string
      password_expires_at: number
      display_name: string
      actions_json: string
    }

    expect(row.display_name).toBe(DISPLAY_NAME)
    expect(row.password_hash).not.toBe(PASSWORD)
    expect(bcrypt.compareSync(PASSWORD, row.password_hash)).toBe(true)
    expect(row.password_expires_at).toBeGreaterThanOrEqual(now + SEVEN_DAYS_MS - 5000)
    expect(JSON.parse(row.actions_json)).toEqual(ACTIONS)
  })

  it('re-register same instance_id rotates password', async () => {
    await register()
    const newPassword = 'Xy9zW8'
    const r = await register({ password: newPassword })
    expect(r.status).toBe(200)

    const oldHb = await heartbeat(INSTANCE_ID, PASSWORD)
    expect(oldHb.status).toBe(401)

    const ok = await heartbeat(INSTANCE_ID, newPassword)
    expect(ok.status).toBe(200)
  })

  it('heartbeat updates last_heartbeat_at and optional actions', async () => {
    await register()
    const before = db
      .prepare('SELECT last_heartbeat_at, actions_json FROM instances WHERE instance_id = ?')
      .get(INSTANCE_ID) as { last_heartbeat_at: number | null; actions_json: string }

    const r = await heartbeat(INSTANCE_ID, PASSWORD, {
      actions: ['ping', 'sync.agents'],
    })
    expect(r.status).toBe(200)

    const after = db
      .prepare('SELECT last_heartbeat_at, actions_json FROM instances WHERE instance_id = ?')
      .get(INSTANCE_ID) as { last_heartbeat_at: number | null; actions_json: string }

    expect(after.last_heartbeat_at).not.toBeNull()
    if (before.last_heartbeat_at != null) {
      expect(after.last_heartbeat_at!).toBeGreaterThanOrEqual(before.last_heartbeat_at)
    }
    expect(JSON.parse(after.actions_json)).toEqual(['ping', 'sync.agents'])
  })

  it('accepts Authorization Basic for instance auth', async () => {
    await register()
    const creds = Buffer.from(`${INSTANCE_ID}:${PASSWORD}`, 'utf8').toString('base64')
    const r = await request(app)
      .post('/api/device/heartbeat')
      .set('Authorization', `Basic ${creds}`)
      .send({})
    expect(r.status).toBe(200)
  })

  it('rejects expired or revoked instance password', async () => {
    await register()
    const past = Date.now() - 1000
    db.prepare(
      `UPDATE instances SET password_expires_at = ? WHERE instance_id = ?`,
    ).run(past, INSTANCE_ID)

    const expired = await heartbeat(INSTANCE_ID, PASSWORD)
    expect(expired.status).toBe(401)

    await register({ password: 'Cd34Ef' })
    const token = await siteToken()
    const revoke = await request(app)
      .delete(`/api/instances/${INSTANCE_ID}/password`)
      .set('Authorization', `Bearer ${token}`)
    expect(revoke.status).toBe(200)

    const revoked = await heartbeat(INSTANCE_ID, 'Cd34Ef')
    expect(revoked.status).toBe(401)
  })

  it('lists instances for site JWT and hides password hash', async () => {
    await register()
    const token = await siteToken()
    const r = await request(app)
      .get('/api/instances')
      .set('Authorization', `Bearer ${token}`)
    expect(r.status).toBe(200)
    expect(r.body.instances).toHaveLength(1)
    expect(r.body.instances[0].instance_id).toBe(INSTANCE_ID)
    expect(r.body.instances[0].password_hash).toBeUndefined()
    expect(r.body.instances[0].has_password).toBe(true)
  })

  it('requires site JWT to list instances', async () => {
    const r = await request(app).get('/api/instances')
    expect(r.status).toBe(401)
  })

  it('allows many successful heartbeats without rate limiting', async () => {
    await register()
    for (let i = 0; i < 12; i += 1) {
      const r = await heartbeat(INSTANCE_ID, PASSWORD)
      expect(r.status).toBe(200)
      expect(r.body.ok).toBe(true)
    }
  })

  it('throttles repeated failed instance auth per IP and instance', async () => {
    await register()
    for (let i = 0; i < 5; i += 1) {
      const r = await heartbeat(INSTANCE_ID, 'wrong1')
      expect(r.status).toBe(401)
    }
    const throttled = await heartbeat(INSTANCE_ID, 'wrong1')
    expect(throttled.status).toBe(401)

    const ok = await heartbeat(INSTANCE_ID, PASSWORD)
    expect(ok.status).toBe(401)
  })
})
