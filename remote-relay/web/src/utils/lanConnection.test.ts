import { describe, expect, it } from 'vitest'
import { LanActionIdempotencyRegistry, createLanImageURL, decideLanActionRecovery, preserveSignedNativeRequestBody } from './lanConnection'

describe('LAN action recovery', () => {
  it('does not fall back to cloud after a dispatched LAN action loses its response', () => {
    expect(decideLanActionRecovery({ phase: 'dispatched', strategy: 'auto' })).toBe('outcome_unknown')
  })

  it('allows cloud fallback only when the LAN preflight failed before dispatch', () => {
    expect(decideLanActionRecovery({ phase: 'preflight_failed', strategy: 'auto' })).toBe('cloud_fallback')
    expect(decideLanActionRecovery({ phase: 'preflight_failed', strategy: 'lan_only' })).toBe('surface_error')
  })

  it('reuses an unknown operation key once, then creates a new key after success', () => {
    let sequence = 0
    const registry = new LanActionIdempotencyRegistry(() => `key-${++sequence}`)
    const fingerprint = 'agent.ask\n{"question":"hello"}'

    const first = registry.acquire(fingerprint)
    registry.keepForUnknownOutcome(fingerprint)
    expect(registry.acquire(fingerprint)).toBe(first)

    registry.clearAfterKnownOutcome(fingerprint)
    expect(registry.acquire(fingerprint)).toBe('key-2')
  })

  it('keeps the signed JSON bytes intact for native action requests', () => {
    const signedBody = '{"action":"chat.send","payload":{"message":"你好"}}'
    expect(preserveSignedNativeRequestBody(signedBody)).toBe(signedBody)
    expect(preserveSignedNativeRequestBody()).toBeUndefined()
  })

  it('creates an expiring LAN image URL without exposing the pairing secret', async () => {
    const url = await createLanImageURL(
      { instanceId: 'instance-1', baseUrl: 'http://172.20.10.2:7943', deviceId: 'iphone-1', deviceSecret: 'test-secret', strategy: 'auto' },
      '/api/chat-images/chat-1.jpg',
      1_700_000_000_000,
    )
    const parsed = new URL(url)
    expect(parsed.origin).toBe('http://172.20.10.2:7943')
    expect(parsed.pathname).toBe('/lan/v1/images/chat-1.jpg')
    expect(parsed.searchParams.get('device_id')).toBe('iphone-1')
    expect(parsed.searchParams.get('expires')).toBe('1700000300')
    expect(parsed.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/)
    expect(url).not.toContain('test-secret')
  })
})
