import test from 'node:test'
import assert from 'node:assert/strict'

import { clampTimeout, isAllowedURL, normalizeBackendURL, normalizeDomains, websocketURL } from '../lib/protocol.mjs'

test('backend only accepts loopback addresses', () => {
  assert.equal(normalizeBackendURL('http://localhost:8080/'), 'http://localhost:8080')
  assert.equal(websocketURL('http://127.0.0.1:8080'), 'ws://127.0.0.1:8080/api/browser/ws')
  assert.throws(() => normalizeBackendURL('https://example.com'), /仅连接本机/)
})

test('domain allowlist supports exact hosts and subdomain wildcards', () => {
  const domains = normalizeDomains(['example.com', '*.atolla.dev'])
  assert.equal(isAllowedURL('https://example.com/a', domains), true)
  assert.equal(isAllowedURL('https://api.atolla.dev/a', domains), true)
  assert.equal(isAllowedURL('https://atolla.dev/a', domains), false)
  assert.equal(isAllowedURL('chrome://settings', domains), false)
  assert.equal(isAllowedURL('https://evil.example/a', domains), false)
})

test('long-running ChatGPT tasks can use a bounded five minute timeout', () => {
  assert.equal(clampTimeout(180000), 180000)
  assert.equal(clampTimeout(600000), 300000)
  assert.equal(clampTimeout(10), 100)
})
