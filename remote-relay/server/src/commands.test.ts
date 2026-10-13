import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './app.js'
import { initDb, type RelayDatabase } from './db.js'

const SITE_PASSWORD = 'secret-gate-pass'
const BCRYPT_ROUNDS = 12

const INSTANCE_ID = 'mac-office-1'
const DISPLAY_NAME = 'Office-Mac'
const PASSWORD = 'Ab12Cd'
const ACTIONS = ['ping', 'sync.agents', 'sync.tasks', 'sync.messages']

let dbPath: string
let db: RelayDatabase
let app: Express

/** Site JWT for enqueue routes */
async function siteToken(): Promise<string> {
  const r = await request(app)
    .post('/api/auth/login')
    .send({ password: SITE_PASSWORD })
  expect(r.status).toBe(200)
  return r.body.token as string
}

/** Register a test instance */
async function register(
  overrides: Partial<{
    instance_id: string
    actions: string[]
  }> = {},
): Promise<void> {
  const r = await request(app)
    .post('/api/device/register')
    .send({
      instance_id: INSTANCE_ID,
      display_name: DISPLAY_NAME,
      password: PASSWORD,
      registry_version: 1,
      actions: ACTIONS,
      ...overrides,
    })
  expect(r.status).toBe(200)
}

/** Enqueue command from site UI */
function enqueue(
  token: string,
  action: string,
  payload: Record<string, unknown> = {},
  instanceId = INSTANCE_ID,
): request.Test {
  return request(app)
    .post(`/api/instances/${instanceId}/commands`)
    .set('Authorization', `Bearer ${token}`)
    .send({ action, payload })
}

/** Long-poll as authenticated device */
function longPoll(
  waitMs?: number,
  instanceId = INSTANCE_ID,
  password = PASSWORD,
): request.Test {
  const q = waitMs != null ? `?wait_ms=${waitMs}` : ''
  return request(app)
    .get(`/api/device/commands/long-poll${q}`)
    .set('X-Instance-Id', instanceId)
    .set('X-Instance-Password', password)
}

/** Post command execution result */
function postResult(
  commandId: string,
  body: { status: string; body?: unknown },
  instanceId = INSTANCE_ID,
  password = PASSWORD,
): request.Test {
  return request(app)
    .post(`/api/device/commands/${commandId}/result`)
    .set('X-Instance-Id', instanceId)
    .set('X-Instance-Password', password)
    .send(body)
}

beforeEach(() => {
  process.env.RELAY_JWT_SECRET = 'test-jwt-secret'
  delete process.env.RELAY_TRUST_PROXY
  dbPath = path.join(os.tmpdir(), `relay-commands-test-${Date.now()}.db`)
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

describe('command queue and long-poll', () => {
  it('enqueues ping when site JWT and instance supports action', async () => {
    await register()
    const token = await siteToken()
    const r = await enqueue(token, 'ping')
    expect(r.status).toBe(200)
    expect(r.body.command.action).toBe('ping')
    expect(r.body.command.status).toBe('pending')
    expect(r.body.command.id).toBeTruthy()
  })

  it('rejects enqueue without site JWT', async () => {
    await register()
    const r = await enqueue('', 'ping')
    expect(r.status).toBe(401)
  })

  it('rejects reserved agent.ask even if instance reports support', async () => {
    await register({ actions: [...ACTIONS, 'agent.ask'] })
    const token = await siteToken()
    const r = await enqueue(token, 'agent.ask', { text: 'hi' })
    expect(r.status).toBe(400)
  })

  it('rejects action not reported by instance', async () => {
    await register({ actions: ['ping'] })
    const token = await siteToken()
    const r = await enqueue(token, 'sync.messages')
    expect(r.status).toBe(400)
  })

  it('rejects enqueue for unknown instance', async () => {
    const token = await siteToken()
    const r = await enqueue(token, 'ping', {}, 'missing-instance')
    expect(r.status).toBe(404)
  })

  it('long-poll leases pending commands and returns them', async () => {
    await register()
    const token = await siteToken()
    const enq = await enqueue(token, 'sync.agents')
    const cmdId = enq.body.command.id as string

    const poll = await longPoll(50)
    expect(poll.status).toBe(200)
    expect(poll.body.commands).toHaveLength(1)
    expect(poll.body.commands[0].id).toBe(cmdId)
    expect(poll.body.commands[0].status).toBe('leased')

    const row = db
      .prepare('SELECT status, leased_until FROM commands WHERE id = ?')
      .get(cmdId) as { status: string; leased_until: number }
    expect(row.status).toBe('leased')
    expect(row.leased_until).toBeGreaterThan(Date.now())
  })

  it('long-poll returns empty array after wait when no commands', async () => {
    await register()
    const started = Date.now()
    const poll = await longPoll(80)
    expect(poll.status).toBe(200)
    expect(poll.body.commands).toEqual([])
    expect(Date.now() - started).toBeGreaterThanOrEqual(70)
  })

  it('accepts command result and stores terminal status', async () => {
    await register()
    const token = await siteToken()
    const enq = await enqueue(token, 'ping')
    const cmdId = enq.body.command.id as string
    await longPoll(50)

    const done = await postResult(cmdId, { status: 'done', body: { ok: true } })
    expect(done.status).toBe(200)

    const row = db
      .prepare('SELECT status, result_json FROM commands WHERE id = ?')
      .get(cmdId) as { status: string; result_json: string }
    expect(row.status).toBe('done')
    expect(JSON.parse(row.result_json)).toEqual({ ok: true })
  })

  it('expires leased commands on next poll when lease elapsed', async () => {
    await register()
    const token = await siteToken()
    const enq = await enqueue(token, 'ping')
    const cmdId = enq.body.command.id as string
    await longPoll(50)

    db.prepare(
      `UPDATE commands SET leased_until = ? WHERE id = ?`,
    ).run(Date.now() - 1000, cmdId)

    const poll = await longPoll(50)
    expect(poll.status).toBe(200)
    expect(poll.body.commands).toEqual([])

    const row = db
      .prepare('SELECT status FROM commands WHERE id = ?')
      .get(cmdId) as { status: string }
    expect(row.status).toBe('expired')
  })
})
