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

/** Unlock instance for site command enqueue */
async function unlock(token: string, instanceId = INSTANCE_ID, password = PASSWORD): Promise<string> {
  const r = await request(app)
    .post(`/api/instances/${instanceId}/unlock`)
    .set('Authorization', `Bearer ${token}`)
    .send({ password })
  expect(r.status).toBe(200)
  return r.body.unlock_token as string
}

/** Enqueue command from site UI (requires unlock) */
function enqueue(
  token: string,
  unlockTok: string,
  action: string,
  payload: Record<string, unknown> = {},
  instanceId = INSTANCE_ID,
): request.Test {
  return request(app)
    .post(`/api/instances/${instanceId}/commands`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Instance-Unlock', unlockTok)
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
    const u = await unlock(token)
    const r = await enqueue(token, u, 'ping')
    expect(r.status).toBe(200)
    expect(r.body.command.action).toBe('ping')
    expect(r.body.command.status).toBe('pending')
    expect(r.body.command.id).toBeTruthy()
  })

  it('rejects enqueue without site JWT', async () => {
    await register()
    const r = await enqueue('', '', 'ping')
    expect(r.status).toBe(401)
  })

  it('rejects enqueue without unlock token', async () => {
    await register()
    const token = await siteToken()
    const r = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'ping' })
    expect(r.status).toBe(403)
  })

  it('enqueues agent.ask when instance reports support', async () => {
    await register({ actions: [...ACTIONS, 'agent.ask'] })
    const token = await siteToken()
    const u = await unlock(token)
    const r = await enqueue(token, u, 'agent.ask', { agent_id: '1', question: 'hi' })
    expect(r.status).toBe(200)
    expect(r.body.command.action).toBe('agent.ask')
  })

  it('enqueues permission and auto-policy actions when supported', async () => {
    await register({
      actions: [
        ...ACTIONS,
        'agent.set_auto_review',
        'agent.set_auto_approve_all',
        'permission.decide',
      ],
    })
    const token = await siteToken()
    const u = await unlock(token)

    const auto = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/1/auto-review`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
      .send({ enabled: true })
    expect(auto.status).toBe(200)
    expect(auto.body.command.action).toBe('agent.set_auto_review')

    const all = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/1/auto-approve-all`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
      .send({ enabled: true })
    expect(all.status).toBe(200)
    expect(all.body.command.action).toBe('agent.set_auto_approve_all')

    const decide = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/1/permissions/decide`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
      .send({ request_id: 'r1', behavior: 'allow' })
    expect(decide.status).toBe(200)
    expect(decide.body.command.action).toBe('permission.decide')
    expect(decide.body.command.payload).toEqual({
      request_id: 'r1',
      behavior: 'allow',
      agent_id: '1',
    })
  })

  it('persists viewer presence even when Mac has not advertised viewer actions', async () => {
    // Only base actions — presence must not depend on action allowlist.
    await register({ actions: ACTIONS })
    const token = await siteToken()
    const u = await unlock(token)

    const set = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/9/viewer`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
      .send({})
    expect(set.status).toBe(200)
    expect(set.body.ok).toBe(true)

    const hb = await request(app)
      .post('/api/device/heartbeat')
      .set('X-Instance-Id', INSTANCE_ID)
      .set('X-Instance-Password', PASSWORD)
      .send({ registry_version: 1, actions: ACTIONS })
    expect(hb.status).toBe(200)
    expect(hb.body.mobile_viewing_agent_id).toBe('9')

    const clear = await request(app)
      .delete(`/api/instances/${INSTANCE_ID}/agents/9/viewer`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
    expect(clear.status).toBe(200)
    expect(clear.body.ok).toBe(true)

    const hb2 = await request(app)
      .post('/api/device/heartbeat')
      .set('X-Instance-Id', INSTANCE_ID)
      .set('X-Instance-Password', PASSWORD)
      .send({ registry_version: 1, actions: ACTIONS })
    expect(hb2.status).toBe(200)
    expect(hb2.body.mobile_viewing_agent_id).toBeNull()
  })

  it('permission decide removes row from permissions mirror immediately', async () => {
    await register({
      actions: [...ACTIONS, 'permission.decide'],
    })
    const token = await siteToken()
    const u = await unlock(token)
    const future = new Date(Date.now() + 60_000).toISOString()

    await request(app)
      .post('/api/device/snapshot/permissions')
      .set('X-Instance-Id', INSTANCE_ID)
      .set('X-Instance-Password', PASSWORD)
      .send({
        permissions: [
          {
            request_id: 'stay-pending',
            agent_id: '1',
            summary: 'ls',
            deadline: future,
          },
        ],
      })

    const before = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/1/permissions/pending`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
    expect(before.body.items).toHaveLength(1)

    const decide = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/1/permissions/decide`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
      .send({ request_id: 'stay-pending', behavior: 'allow_session' })
    expect(decide.status).toBe(200)

    const after = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/1/permissions/pending`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', u)
    expect(after.body.items).toEqual([])
  })

  it('rejects action not reported by instance', async () => {
    await register({ actions: ['ping'] })
    const token = await siteToken()
    const u = await unlock(token)
    const r = await enqueue(token, u, 'sync.messages')
    expect(r.status).toBe(400)
  })

  it('rejects unlock for unknown instance', async () => {
    const token = await siteToken()
    const r = await request(app)
      .post('/api/instances/missing-instance/unlock')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD })
    expect(r.status).toBe(401)
  })

  it('long-poll leases pending commands and returns them', async () => {
    await register()
    const token = await siteToken()
    const u = await unlock(token)
    const enq = await enqueue(token, u, 'sync.agents')
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
    const u = await unlock(token)
    const enq = await enqueue(token, u, 'ping')
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
    const u = await unlock(token)
    const enq = await enqueue(token, u, 'ping')
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

  it('settings get waits for Mac result via enqueueAndWait', async () => {
    await register({
      actions: [...ACTIONS, 'agent.settings.get'],
    })
    const token = await siteToken()
    const u = await unlock(token)

    /** Simulate Mac: wait for queued command, lease, submit result */
    const macSide = (async () => {
      let cmdId = ''
      for (let i = 0; i < 100; i++) {
        const row = db
          .prepare(
            `SELECT id FROM commands WHERE action_type = ? ORDER BY created_at DESC LIMIT 1`,
          )
          .get('agent.settings.get') as { id: string } | undefined
        if (row?.id) {
          cmdId = row.id
          break
        }
        await new Promise((r) => setTimeout(r, 15))
      }
      expect(cmdId).toBeTruthy()
      const poll = await longPoll(200)
      expect(poll.body.commands.some((c: { id: string }) => c.id === cmdId)).toBe(true)
      await postResult(cmdId, {
        status: 'done',
        body: {
          agent_id: '7',
          name: 'Ada',
          engine: 'claude',
          rules_prompt: 'hi',
          skill_count: 1,
        },
      })
    })()

    // Promise.all starts the HTTP request (supertest thenable) in parallel with Mac
    const [res] = await Promise.all([
      request(app)
        .get(`/api/instances/${INSTANCE_ID}/agents/7/settings`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Instance-Unlock', u),
      macSide,
    ])

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Ada')
    expect(res.body.rules_prompt).toBe('hi')
  })

  it('settings get returns 504 when Mac never replies', async () => {
    await register({
      actions: [...ACTIONS, 'agent.settings.get'],
    })
    const { enqueueAndWait } = await import('./commands.js')
    const result = await enqueueAndWait(
      db,
      INSTANCE_ID,
      'agent.settings.get',
      { agent_id: '1' },
      80,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(504)
    }
  })
})
