import assert from 'node:assert/strict'
import test from 'node:test'
import { createDevBackendManager } from '../scripts/dev-backend.mjs'

test('Electron relaunch reuses the same development backend', async () => {
  let starts = 0
  let stops = 0
  const manager = createDevBackendManager({ start: async (userDataPath) => {
    starts++
    assert.equal(userDataPath, '/user/Atolla')
    return { baseUrl: 'http://127.0.0.1:8080', stop: async () => { stops++ } }
  } })
  const [first, second] = await Promise.all([manager.ensure('/user/Atolla'), manager.ensure('/user/Atolla')])
  assert.equal(first.baseUrl, second.baseUrl)
  assert.equal(starts, 1)
  assert.equal(stops, 0)
  await manager.shutdown()
  assert.equal(stops, 1)
})

test('explicit restart replaces the development backend and can recover from startup failure', async () => {
  let starts = 0
  let stops = 0
  const manager = createDevBackendManager({ start: async () => {
    starts++
    if (starts === 2) throw new Error('new config invalid')
    return { baseUrl: 'http://127.0.0.1:8080', stop: async () => { stops++ } }
  } })
  await manager.ensure('/user/Atolla')
  await assert.rejects(manager.restart(), /new config invalid/)
  assert.equal(stops, 1)
  await manager.ensure('/user/Atolla')
  assert.equal(starts, 3)
  await manager.shutdown()
  assert.equal(stops, 2)
})
