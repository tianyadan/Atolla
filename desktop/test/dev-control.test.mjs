import assert from 'node:assert/strict'
import test from 'node:test'
import { createDevControlServer } from '../scripts/dev-control.mjs'

test('dev-runner control server exclusively owns backend lifecycle', async (t) => {
  const calls = []
  const manager = {
    async ensure(userDataPath) {
      calls.push(['ensure', userDataPath])
      return { baseUrl: 'http://127.0.0.1:8080' }
    },
    async restart() {
      calls.push(['restart'])
      return { baseUrl: 'http://127.0.0.1:8080' }
    },
  }
  const control = await createDevControlServer({ backendManager: manager })
  t.after(() => control.close())

  const denied = await fetch(`${control.url}/v1/backend/ensure`, { method: 'POST' })
  assert.equal(denied.status, 401)

  const headers = {
    authorization: `Bearer ${control.token}`,
    'content-type': 'application/json',
  }
  const ensured = await fetch(`${control.url}/v1/backend/ensure`, {
    method: 'POST', headers, body: JSON.stringify({ userDataPath: '/tmp/Atolla' }),
  })
  assert.deepEqual(await ensured.json(), { baseUrl: 'http://127.0.0.1:8080' })

  const restarted = await fetch(`${control.url}/v1/backend/restart`, { method: 'POST', headers })
  assert.deepEqual(await restarted.json(), { baseUrl: 'http://127.0.0.1:8080' })
  assert.deepEqual(calls, [['ensure', '/tmp/Atolla'], ['restart']])
})
