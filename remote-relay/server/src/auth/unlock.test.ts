import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../app.js'
import { initDb, type RelayDatabase } from '../db.js'
import { AUTH_ERROR_MESSAGE } from './site.js'
import { UNLOCK_LOCK_MESSAGE } from './unlock.js'

const SITE_PASSWORD = 'secret-gate-pass'
const INSTANCE_ID = 'mac-1'
const PASSWORD = 'Ab12Cd'
const BCRYPT_ROUNDS = 12

let dbPath: string
let db: RelayDatabase
let app: Express

beforeEach(() => {
  process.env.RELAY_JWT_SECRET = 'test-jwt-secret'
  dbPath = path.join(os.tmpdir(), `relay-unlock-${Date.now()}.db`)
  db = initDb(dbPath)
  const now = Date.now()
  db.prepare(
    `INSERT INTO site_auth (id, password_hash, token_version, failed_attempt_count, locked_until, updated_at)
     VALUES (1, ?, 1, 0, NULL, ?)`,
  ).run(bcrypt.hashSync(SITE_PASSWORD, BCRYPT_ROUNDS), now)
  app = createApp(db)
})

afterEach(() => {
  db.close()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  delete process.env.RELAY_JWT_SECRET
})

async function login(): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ password: SITE_PASSWORD })
  expect(r.status).toBe(200)
  return r.body.token as string
}

async function register(): Promise<void> {
  const r = await request(app)
    .post('/api/device/register')
    .send({
      instance_id: INSTANCE_ID,
      display_name: 'Mac',
      password: PASSWORD,
      registry_version: 1,
      actions: ['ping'],
    })
  expect(r.status).toBe(200)
}

describe('instance unlock', () => {
  it('issues unlock_token for correct password', async () => {
    await register()
    const token = await login()
    const r = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/unlock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD })
    expect(r.status).toBe(200)
    expect(r.body.unlock_token).toBeTruthy()
    expect(r.body.expires_in).toBe(24 * 3600)
  })

  it('rejects wrong password with unified message', async () => {
    await register()
    const token = await login()
    const r = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/unlock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Wrong1' })
    expect(r.status).toBe(401)
    expect(r.body.error).toBe(AUTH_ERROR_MESSAGE)
  })

  it('locks after five wrong attempts', async () => {
    await register()
    const token = await login()
    for (let i = 0; i < 4; i++) {
      const r = await request(app)
        .post(`/api/instances/${INSTANCE_ID}/unlock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'Wrong1' })
      expect(r.status).toBe(401)
    }
    const fifth = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/unlock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Wrong1' })
    expect(fifth.status).toBe(429)
    expect(fifth.body.error).toBe(UNLOCK_LOCK_MESSAGE)

    const still = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/unlock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD })
    expect(still.status).toBe(429)
  })
})
