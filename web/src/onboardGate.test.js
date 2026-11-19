import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldSkipOnboarding } from './onboardGate.js'

test('local done skips', () => {
  assert.equal(shouldSkipOnboarding({ localDone: true, needsRegister: true, engines: [], dbChosen: false }), true)
})

test('existing admin skips even without local flag', () => {
  assert.equal(
    shouldSkipOnboarding({
      localDone: false,
      needsRegister: false,
      engines: [{ installed: false }],
      dbChosen: false,
    }),
    true,
  )
})

test('engines + db chosen skips', () => {
  assert.equal(
    shouldSkipOnboarding({
      localDone: false,
      needsRegister: true,
      engines: [{ installed: true }],
      dbChosen: true,
    }),
    true,
  )
})

test('fresh machine still needs onboard', () => {
  assert.equal(
    shouldSkipOnboarding({
      localDone: false,
      needsRegister: true,
      engines: [{ installed: false }],
      dbChosen: false,
    }),
    false,
  )
})
