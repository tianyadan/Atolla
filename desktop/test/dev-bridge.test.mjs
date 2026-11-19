import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { requestDevBackend } from '../dev-bridge.mjs'

test('Electron waits for runner backend readiness before opening the window', async () => {
  const channel = new EventEmitter()
  channel.send = (message) => {
    assert.deepEqual(message, { type: 'atolla:dev-start', userDataPath: '/user/Atolla' })
    queueMicrotask(() => channel.emit('message', { type: 'atolla:dev-ready', baseUrl: 'http://127.0.0.1:8080' }))
  }
  assert.equal(await requestDevBackend(channel, { type: 'atolla:dev-start', userDataPath: '/user/Atolla' }, 'atolla:dev-ready'), 'http://127.0.0.1:8080')
  assert.equal(channel.listenerCount('message'), 0)
})

test('runner startup errors are returned instead of showing a broken window', async () => {
  const channel = new EventEmitter()
  channel.send = () => queueMicrotask(() => channel.emit('message', { type: 'atolla:dev-error', error: 'port occupied' }))
  await assert.rejects(requestDevBackend(channel, { type: 'atolla:dev-start' }, 'atolla:dev-ready'), /port occupied/)
  assert.equal(channel.listenerCount('message'), 0)
})

test('IPC send failure removes the pending response listener', async () => {
  const channel = new EventEmitter()
  channel.send = () => { throw new Error('IPC channel closed') }
  await assert.rejects(requestDevBackend(channel, { type: 'atolla:dev-start' }, 'atolla:dev-ready'), /IPC channel closed/)
  assert.equal(channel.listenerCount('message'), 0)
})
