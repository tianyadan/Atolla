import test from 'node:test'
import assert from 'node:assert/strict'
import { runningElapsedSec, taskStartedAtMs } from './taskTiming.js'

test('task timer accepts ISO, unix seconds and unix milliseconds', () => {
  const now = Date.parse('2026-10-27T03:27:10Z')
  assert.equal(runningElapsedSec('2026-10-27T03:27:00Z', now), 10)
  assert.equal(runningElapsedSec((now - 20_000) / 1000, now), 20)
  assert.equal(runningElapsedSec(now - 30_000, now), 30)
})
test('task timer repairs legacy local wall time parsed as UTC', () => {
  const now = Date.parse('2026-10-27T03:27:10Z')
  const legacy = Date.parse('2026-10-27T11:25:23Z')
  assert.equal(taskStartedAtMs(legacy, now, -480), Date.parse('2026-10-27T03:25:23Z'))
  assert.equal(runningElapsedSec(legacy, now, -480), 107)
})
