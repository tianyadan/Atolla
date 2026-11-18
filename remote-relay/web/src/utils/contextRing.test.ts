import { describe, expect, it } from 'vitest'
import {
  agentContextUsage,
  contextRingFillRatio,
  contextRingLabel,
  contextUsageKnown,
} from './agentStatus'

describe('context ring display', () => {
  it('prefers used_percent from payload', () => {
    const u = agentContextUsage({
      used_tokens: 500000,
      window_tokens: 262144,
      used_percent: 41.3,
      estimated: false,
      context_source: 'codex_session',
    })
    expect(u.pct).toBeCloseTo(41.3)
    expect(contextUsageKnown(u)).toBe(true)
    expect(contextRingLabel(u)).toBe('41')
    expect(contextRingFillRatio(u)).toBeCloseTo(0.413)
  })

  it('caps overflow label at 100 instead of showing !', () => {
    const u = agentContextUsage({
      used_tokens: 501599,
      window_tokens: 262144,
      used_percent: 191.3,
      estimated: true,
      context_source: 'cached',
      anomaly: 'current_context_exceeds_window',
    })
    expect(u.pct).toBeGreaterThan(100)
    expect(contextUsageKnown(u)).toBe(true)
    expect(contextRingLabel(u)).toBe('100')
    expect(contextRingFillRatio(u)).toBe(1)
  })

  it('hides ring when window unknown or source unavailable', () => {
    expect(contextUsageKnown(agentContextUsage({ window_tokens: 0 }))).toBe(false)
    expect(
      contextUsageKnown(
        agentContextUsage({
          used_tokens: 0,
          window_tokens: 1000000,
          context_source: 'unavailable',
        }),
      ),
    ).toBe(false)
    expect(
      contextUsageKnown(
        agentContextUsage({
          used_tokens: 0,
          window_tokens: 1000000,
          context_source: '',
        }),
      ),
    ).toBe(false)
    expect(contextRingLabel(agentContextUsage({ window_tokens: 0 }))).toBe('')
  })
})
