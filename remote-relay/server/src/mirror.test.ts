import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './app.js'
import { initDb, type RelayDatabase } from './db.js'
import { claimPendingCommands, submitCommandResult } from './commands.js'

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

/** Unlock token for instance detail APIs */
async function unlockToken(siteTok: string): Promise<string> {
  const r = await request(app)
    .post(`/api/instances/${INSTANCE_ID}/unlock`)
    .set('Authorization', `Bearer ${siteTok}`)
    .send({ password: PASSWORD })
  expect(r.status).toBe(200)
  return r.body.unlock_token as string
}

/** Register test instance */
async function register(actions: string[] = ACTIONS): Promise<void> {
  const r = await request(app)
    .post('/api/device/register')
    .send({
      instance_id: INSTANCE_ID,
      display_name: DISPLAY_NAME,
      password: PASSWORD,
      registry_version: 1,
      actions,
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
  delete process.env.RELAY_SIRI_RECEPTIONIST_WAIT_MS
})

describe('mirror snapshot ingest and site read', () => {
  it('asks Receptionist through the Mac RPC and returns the stable Siri response', async () => {
    await register([...ACTIONS, 'receptionist.ask'])
    const token = await siteToken()
    const unlock = await unlockToken(token)

    const macSide = (async () => {
      let command = claimPendingCommands(db, INSTANCE_ID, Date.now())[0]
      for (let attempt = 0; !command && attempt < 100; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        command = claimPendingCommands(db, INSTANCE_ID, Date.now())[0]
      }
      expect(command?.action).toBe('receptionist.ask')
      expect(command?.payload.question).toBe('今天有什么安排？')
      const result = submitCommandResult(
        db,
        INSTANCE_ID,
        command!.id,
        'done',
        { answer: '今天先完成 Siri 接入。', conversation_id: 12, reply_ms: 850 },
      )
      expect(result.ok).toBe(true)
    })()

    const [response] = await Promise.all([
      request(app)
        .post(`/api/instances/${INSTANCE_ID}/siri/receptionist/ask`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Instance-Unlock', unlock)
        .send({ question: '今天有什么安排？' }),
      macSide,
    ])

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      answer: '今天先完成 Siri 接入。',
      conversation_id: 12,
      reply_ms: 850,
    })
  })

  it('returns an explicit Mac offline code before asking Receptionist', async () => {
    await register([...ACTIONS, 'receptionist.ask'])
    const token = await siteToken()
    const unlock = await unlockToken(token)
    db.prepare('UPDATE instances SET last_heartbeat_at = ? WHERE instance_id = ?')
      .run(Date.now() - 120_000, INSTANCE_ID)

    const response = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/siri/receptionist/ask`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
      .send({ question: 'Mac 在线吗？' })

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('MAC_OFFLINE')
  })

  it('degrades a slow Receptionist answer to an accepted Siri prompt', async () => {
    process.env.RELAY_SIRI_RECEPTIONIST_WAIT_MS = '30'
    await register([...ACTIONS, 'receptionist.ask'])
    const token = await siteToken()
    const unlock = await unlockToken(token)

    const response = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/siri/receptionist/ask`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
      .send({ question: '请给出一份很长的回答。' })

    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      submitted: true,
      pending: true,
      answer: '',
    })
    expect(response.body.speech_text).toContain('稍后打开 Atolla 查看')
  })



  it('lists Siri agent entities and filters by group or working status', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)

    await devicePost('/api/device/snapshot/agents', {
      agents: [
        {
          agent_id: 'a1',
          display_name: 'Alpha',
          engine: 'claude',
          status: 'running',
          payload: { folder_name: '研发组' },
        },
        {
          agent_id: 'a2',
          display_name: 'Beta',
          engine: 'codex',
          status: 'idle',
          payload: { folder_name: '研发组' },
        },
        {
          agent_id: 'a3',
          display_name: 'Gamma',
          engine: 'codex',
          status: 'waiting',
          payload: { folder_name: '运营组' },
        },
      ],
    })

    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Instance-Unlock': unlock,
    }
    const all = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/siri/agents`)
      .set(headers)
    expect(all.status).toBe(200)
    expect(all.body.agents).toHaveLength(3)
    expect(all.body.agents[0]).toMatchObject({
      id: `${INSTANCE_ID}:a1`,
      instance_id: INSTANCE_ID,
      agent_id: 'a1',
      name: 'Alpha',
      group_name: '研发组',
      status: 'running',
      working: true,
    })
    expect(all.body.agents[0].speech_text).toContain('Alpha')

    const group = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/siri/agents?group=${encodeURIComponent('研发组')}`)
      .set(headers)
    expect(group.body.agents.map((agent: { agent_id: string }) => agent.agent_id)).toEqual(['a1', 'a2'])

    const working = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/siri/agents?working=true`)
      .set(headers)
    expect(working.body.agents.map((agent: { agent_id: string }) => agent.agent_id)).toEqual(['a1', 'a3'])
  })

  it('adds group and agent id labels for duplicate Siri agent names', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)
    await devicePost('/api/device/snapshot/agents', {
      agents: [
        { agent_id: '11', display_name: '小安', status: 'idle', payload: { folder_name: '研发组' } },
        { agent_id: '12', display_name: '小安', status: 'idle', payload: { folder_name: '运营组' } },
        { agent_id: '13', display_name: '小安', status: 'idle', payload: { folder_name: '研发组' } },
      ],
    })

    const response = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/siri/agents`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(response.status).toBe(200)
    const labels = Object.fromEntries(
      response.body.agents.map((agent: { agent_id: string; disambiguation_label: string }) => [
        agent.agent_id,
        agent.disambiguation_label,
      ]),
    )
    expect(labels).toEqual({
      '11': '小安（研发组，编号 11）',
      '12': '小安（运营组）',
      '13': '小安（研发组，编号 13）',
    })
  })

  it('returns rules-based Siri status and explains offline stale mirrors', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)
    await devicePost('/api/device/snapshot/agents', {
      agents: [{
        agent_id: AGENT_ID,
        display_name: 'Alpha',
        status: 'running',
        payload: { folder_name: '研发组' },
      }],
    })
    await devicePost('/api/device/snapshot/tasks', {
      tasks: [{
        agent_id: AGENT_ID,
        task_id: 'task-current',
        status: 'running',
        payload: { task_name: '实现 Siri', progress: 35 },
      }],
    })
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Instance-Unlock': unlock,
    }
    const online = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/siri/agents/${AGENT_ID}/status`)
      .set(headers)
    expect(online.status).toBe(200)
    expect(online.body).toMatchObject({
      machine_status: 'online',
      status: 'running',
      progress: 35,
      current_task: '实现 Siri',
      stale: false,
      source: 'rules',
    })
    expect(online.body.speech_text).toContain('进度百分之35')

    const old = Date.now() - 120_000
    db.prepare('UPDATE instances SET last_heartbeat_at = ? WHERE instance_id = ?').run(old, INSTANCE_ID)
    db.prepare('UPDATE agents_mirror SET synced_at = ? WHERE instance_id = ?').run(old, INSTANCE_ID)
    db.prepare('UPDATE tasks_mirror SET synced_at = ? WHERE instance_id = ?').run(old, INSTANCE_ID)

    const offline = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/siri/agents/${AGENT_ID}/status`)
      .set(headers)
    expect(offline.body.machine_status).toBe('offline')
    expect(offline.body.stale).toBe(true)
    expect(offline.body.speech_text).toContain('离线')
    expect(offline.body.speech_text).toContain('可能已经过期')
  })

  it('prunes agents removed from a later full snapshot', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)

    expect(
      (
        await devicePost('/api/device/snapshot/agents', {
          agents: [
            { agent_id: 'a1', display_name: 'Keep', engine: 'claude', status: 'idle' },
            { agent_id: 'a2', display_name: 'Gone', engine: 'claude', status: 'idle' },
          ],
        })
      ).status,
    ).toBe(200)

    expect(
      (
        await devicePost('/api/device/snapshot/agents', {
          agents: [{ agent_id: 'a1', display_name: 'Keep', engine: 'claude', status: 'idle' }],
        })
      ).status,
    ).toBe(200)

    const listed = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(listed.status).toBe(200)
    const ids = (listed.body.agents || []).map((a: { agent_id: string }) => a.agent_id)
    expect(ids).toEqual(['a1'])
  })

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

    const unlock = await unlockToken(token)

    const agents = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(agents.status).toBe(200)
    expect(agents.body.agents).toHaveLength(1)
    expect(agents.body.agents[0].display_name).toBe('Alpha')

    const tasks = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(tasks.status).toBe(200)
    expect(tasks.body.tasks[0].task_id).toBe('task-1')

    const latest = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/messages?limit=2`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
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
      .set('X-Instance-Unlock', unlock)
    expect(older.status).toBe(200)
    expect(older.body.messages.map((m: { message_id: string }) => m.message_id)).toEqual(['m1'])
  })

  it('sync-messages enqueues sync.messages with agent_id', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)

    const r = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/sync-messages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
      .send({ limit: 50 })

    expect(r.status).toBe(200)
    expect(r.body.command.action).toBe('sync.messages')
    expect(r.body.command.payload).toEqual({ agent_id: AGENT_ID, limit: 50 })
  })

  it('rejects agents without unlock token', async () => {
    await register()
    const token = await siteToken()
    const r = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents`)
      .set('Authorization', `Bearer ${token}`)
    expect(r.status).toBe(403)
  })

  it('rejects snapshot without instance auth', async () => {
    await register()
    const r = await request(app)
      .post('/api/device/snapshot/agents')
      .send({ agents: [{ agent_id: 'x' }] })
    expect(r.status).toBe(401)
  })

  it('upserts permissions and lists pending; resolved deletes', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)
    const future = new Date(Date.now() + 60_000).toISOString()

    const snap = await devicePost('/api/device/snapshot/permissions', {
      permissions: [
        {
          request_id: 'req-1',
          agent_id: AGENT_ID,
          conversation_id: 9,
          tool_name: 'Bash',
          summary: 'ls -la',
          meaning: '列目录',
          risk: 'low',
          deadline: future,
        },
        {
          request_id: 'req-other',
          agent_id: 'other-agent',
          summary: 'rm -rf /',
          deadline: future,
        },
      ],
    })
    expect(snap.status).toBe(200)
    expect(snap.body.upserted).toBe(2)

    const list = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/permissions/pending`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].request_id).toBe('req-1')
    expect(list.body.items[0].summary).toBe('ls -la')

    const resolved = await devicePost('/api/device/permissions/resolved', {
      request_ids: ['req-1'],
    })
    expect(resolved.status).toBe(200)
    expect(resolved.body.deleted).toBe(1)

    const after = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/permissions/pending`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(after.status).toBe(200)
    expect(after.body.items).toEqual([])
  })

  it('lists live pending permissions for an unlocked instance', async () => {
    await register()
    const token = await siteToken()
    const unlock = await unlockToken(token)
    const future = new Date(Date.now() + 60_000).toISOString()
    const expired = new Date(Date.now() - 60_000).toISOString()

    await devicePost('/api/device/snapshot/agents', {
      agents: [
        { agent_id: 'agent-a', display_name: 'A', status: 'idle' },
        { agent_id: 'agent-b', display_name: 'B', status: 'idle' },
      ],
    })
    await devicePost('/api/device/snapshot/permissions', {
      permissions: [
        { request_id: 'req-b', agent_id: 'agent-b', summary: 'deploy', deadline: future },
        { request_id: 'req-a', agent_id: 'agent-a', summary: 'write', deadline: future },
        { request_id: 'req-expired', agent_id: 'agent-a', summary: 'old', deadline: expired },
      ],
    })

    const withoutUnlock = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/permissions/pending`)
      .set('Authorization', `Bearer ${token}`)
    expect(withoutUnlock.status).toBe(403)

    const list = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/permissions/pending`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(list.status).toBe(200)
    expect(list.body.items.map((item: { request_id: string }) => item.request_id)).toEqual([
      'req-a',
      'req-b',
    ])

    const unknown = await request(app)
      .get('/api/instances/missing-instance/permissions/pending')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(unknown.status).toBe(404)
  })

  it('mark-read clears task_unread in agents mirror immediately', async () => {
    // 注册含 agent.mark_read，模拟 Mac 已上报该动作
    await request(app)
      .post('/api/device/register')
      .send({
        instance_id: INSTANCE_ID,
        display_name: DISPLAY_NAME,
        password: PASSWORD,
        registry_version: 1,
        actions: [...ACTIONS, 'agent.mark_read'],
      })
    const token = await siteToken()
    const unlock = await unlockToken(token)

    await devicePost('/api/device/snapshot/agents', {
      agents: [
        {
          agent_id: AGENT_ID,
          display_name: 'Alpha',
          status: 'idle',
          payload: {
            task_unread: true,
            task_unread_kind: 'completed',
            task_unread_at: 1_700_000_000,
            task_unread_duration_ms: 1200,
            task_unread_summary: 'done',
          },
        },
      ],
    })

    const before = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(before.status).toBe(200)
    expect(before.body.agents[0].payload.task_unread).toBe(true)

    const mark = await request(app)
      .post(`/api/instances/${INSTANCE_ID}/agents/${AGENT_ID}/mark-read`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
      .send({})
    expect(mark.status).toBe(202)

    const after = await request(app)
      .get(`/api/instances/${INSTANCE_ID}/agents`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Instance-Unlock', unlock)
    expect(after.status).toBe(200)
    expect(after.body.agents[0].payload.task_unread).toBe(false)
    expect(after.body.agents[0].payload.task_unread_kind).toBe('')
    expect(after.body.agents[0].payload.task_unread_at).toBeNull()
  })
})
