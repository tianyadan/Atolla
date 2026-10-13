import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './app.js'
import { initDb, type RelayDatabase } from './db.js'

const SITE_PASSWORD = 'secret-gate-pass'
const INSTANCE_ID = 'mac-office-1'
const DISPLAY_NAME = 'Office-Mac'
const PASSWORD = 'Ab12Cd'
const AGENT_ID = 'agent-alpha'
const ACTIONS = ['ping', 'sync.agents', 'sync.tasks', 'sync.messages']

let dbPath: string
let db: RelayDatabase
let app: Express

/** Site JWT for read routes */
async function siteToken(): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ password: SITE_PASSWORD })
  expect(r.status).toBe(200)
  return r.body.token as string
}

/** Register test instance */
async function register(): Promise<void> {
  const r = await request(app)
    .post('/api/device/register')
    .send({
      instance_id: INSTANCE_ID,
      display_name: DISPLAY_NAME,
      password: PASSWORD,
      registry_version: 1,
      actions: ACTIONS,
    })
  expect(r.status).toBe(200)
}

/** Authenticated device POST helper */
function devicePost(url: string, body: object): request.Test {
  return request(app)
    .post(url)
    .set('X-Instance-Id', INSTANCE_ID)
    .set('X-Instance-Password', PASSWORD)
    .send(body)
}

beforeEach(() => {
  process.env.SITE_PASSWORD = SITE_PASSWORD
  dbPath = path.join(os.tmpdir(), `relay-mirror-${Date.now()}-${Math.random()}.db`)
  db = initDb(dbPath)
  app = createApp(db)
})

afterEach(() => {
  db.close()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  delete process.env.SITE_PASSWORD
})

describe('mirror snapshot ingest and site read', () => {
  it('upserts agents/tasks/messages and reads them with pagination', async () => {
    await register()
    const token = await siteToken()

    expect(
      (
        await devicePost('/api/device/snapshot/agents', {
          agents: [
            {
              agent_id: AGENT_ID,
              display_name: 'Alpha',
              engine: 'claude',
              status: 'idle',
            },
          ],
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await devicePost('/api/device/snapshot/tasks', {
          tasks: [{ agent_id: AGENT_ID, task_id: 'task-1', status: 'running' }],
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await devicePost('/api/device/snapshot/messages', {
          messages: [
            {
              message_id: 'm1',
              agent_id: AGENT_ID,
              role: 'user',
              content: 'hello',
              created_at: 1000,
            },
            {
              message_id: 'm2',
              agent_id: AGENT_ID,
              role: 'assistant',
              content: 'hi',
              created_at: 2000,
            },
            {
              message_id: 'm3',
              agent_id: AGENT_ID,
              role: 'user',
              content: 'more',
              created_at: 3000,
            },
          ],
        })
      ).status,
    ).toBe(200)

    const agents = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents`)
      .set('Authorization', `Bearer ${token}`)
    expect(agents.status).toBe(200)
    expect(agents.body.agents).toHaveLength(1)
    expect(agents.body.agents[0].display_name).toBe('Alpha')

    const tasks = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/tasks`)
      .set('Authorization', `Bearer ${token}`)
    expect(tasks.status).toBe(200)
    expect(tasks.body.tasks[0].task_id).toBe('task-1')

    const latest = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/messages?limit=2`)
      .set('Authorization', `Bearer ${token}`)
    expect(latest.status).toBe(200)
    expect(latest.body.messages.map((m: { message_id: string }) => m.message_id)).toEqual([
      'm2',
      'm3',
    ])
    expect(latest.body.has_more).toBe(true)

    const older = await request(app)
      .get(
        `/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/messages?before_id=m2&limit=10`,
      )
      .set('Authorization', `Bearer ${token}`)
    expect(older.status).toBe(200)
    expect(older.body.messages.map((m: { message_id: string }) => m.message_id)).toEqual(['m1'])
  })

  it('sync-messages enqueues sync.messages with agent_id', async () => {
    await register()
    const token = await siteToken()

    const r = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/sync-messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ limit: 50 })

    expect(r.status).toBe(200)
    expect(r.body.command.action).toBe('sync.messages')
    expect(r.body.command.payload).toEqual({ agent_id: AGENT_ID, limit: 50 })
  })

  it('rejects snapshot without instance auth', async () => {
    await register()
    const r = await request(app)
      .post('/api/device/snapshot/agents')
      .send({ agents: [{ agent_id: 'x' }] })
    expect(r.status).toBe(401)
  })
})
