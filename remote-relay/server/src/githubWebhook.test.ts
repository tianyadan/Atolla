import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { initDb, type RelayDatabase } from './db.js'

const INSTANCE_ID = 'github-idea-mac'
let dbPath: string
let db: RelayDatabase
let app: Express

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atolla-github-webhook-')), 'relay.db')
  db = initDb(dbPath)
  app = createApp(db)
})

afterEach(() => {
  db.close()
})

async function register(): Promise<void> {
  const result = await request(app).post('/api/device/register').send({
    instance_id: INSTANCE_ID,
    display_name: 'Idea Mac',
    password: 'Ab12Cd',
    registry_version: 1,
    actions: ['github.idea.event'],
  })
  expect(result.status).toBe(200)
}

describe('GitHub webhook relay', () => {
  it('forwards opened issue with the exact raw body', async () => {
    await register()
    const payload = { action: 'opened', issue: { number: 12, title: 'Idea' } }
    const signature = `sha256=${'a'.repeat(64)}`
    const accepted = await request(app)
      .post(`/api/webhooks/github/${INSTANCE_ID}`)
      .set('X-GitHub-Delivery', 'delivery-1')
      .set('X-GitHub-Event', 'issues')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
    expect(accepted.status).toBe(202)
    expect(accepted.body.accepted).toBe(true)

    const polled = await request(app)
      .get('/api/device/commands/long-poll?wait_ms=0')
      .set('X-Instance-Id', INSTANCE_ID)
      .set('X-Instance-Password', 'Ab12Cd')
    expect(polled.status).toBe(200)
    expect(polled.body.commands[0].action).toBe('github.idea.event')
    const raw = Buffer.from(polled.body.commands[0].payload.body_base64, 'base64').toString('utf8')
    expect(JSON.parse(raw)).toEqual(payload)
    expect(polled.body.commands[0].payload.signature).toBe(signature)
  })

  it('forwards edited and reopened issues', async () => {
    await register()
    for (const [index, action] of ['edited', 'reopened'].entries()) {
      const result = await request(app)
        .post(`/api/webhooks/github/${INSTANCE_ID}`)
        .set('X-GitHub-Delivery', `delivery-supported-${index}`)
        .set('X-GitHub-Event', 'issues')
        .set('X-Hub-Signature-256', `sha256=${'c'.repeat(64)}`)
        .send({ action, issue: { number: 12 } })
      expect(result.status).toBe(202)
      expect(result.body.accepted).toBe(true)
    }
  })

  it('ignores unsupported issue actions and pull request events', async () => {
    await register()
    for (const [event, action] of [['issues', 'closed'], ['pull_request', 'opened']]) {
      const result = await request(app)
        .post(`/api/webhooks/github/${INSTANCE_ID}`)
        .set('X-GitHub-Delivery', `delivery-${event}`)
        .set('X-GitHub-Event', event)
        .set('X-Hub-Signature-256', `sha256=${'b'.repeat(64)}`)
        .send({ action })
      expect(result.status).toBe(202)
      expect(result.body.ignored).toBe(true)
    }
  })
})
