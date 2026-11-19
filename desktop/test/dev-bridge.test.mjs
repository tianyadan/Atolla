import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requestDevRunnerBackend,
  resolveDevRunnerControl,
} from '../dev-bridge.mjs'

test('dev-runner ownership requires an authenticated control endpoint, not Electron IPC', async () => {
  const control = resolveDevRunnerControl({
    ATOLLA_DEV_RUNNER: '1',
    ATOLLA_DEV_CONTROL_URL: 'http://127.0.0.1:45123',
    ATOLLA_DEV_CONTROL_TOKEN: 'test-token',
    ATOLLA_DEV_USER_DATA_PATH: '/user/Atolla',
  })
  assert.deepEqual(control, { url: 'http://127.0.0.1:45123', token: 'test-token', userDataPath: '/user/Atolla' })
  assert.throws(() => resolveDevRunnerControl({ ATOLLA_DEV_RUNNER: '1' }), /control endpoint unavailable/)

  const calls = []
  const baseUrl = await requestDevRunnerBackend(control, 'ensure', { userDataPath: '/user/Atolla' }, async (url, init) => {
    calls.push([url, init])
    return new Response(JSON.stringify({ baseUrl: 'http://127.0.0.1:8080' }), { status: 200 })
  })
  assert.equal(baseUrl, 'http://127.0.0.1:8080')
  assert.equal(calls[0][0], 'http://127.0.0.1:45123/v1/backend/ensure')
  assert.equal(calls[0][1].headers.authorization, 'Bearer test-token')
})
