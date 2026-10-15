import { describe, expect, it } from 'vitest'
import {
  agentContextUsage,
  contextRingFillRatio,
  contextRingLabel,
} from './agentStatus'

describe('context ring display (PC-aligned)', () => {
  it('prefers used_percent from payload', () => {
    const u = agentContextUsage({
      used_tokens: 500000,
      window_tokens: 262144,
      used_percent: 41.3,
      estimated: false,
      context_source: 'codex_session',
    })
    expect(u.pct).toBeCloseTo(41.3)
    expect(contextRingLabel(u)).toBe('41')
    expect(contextRingFillRatio(u)).toBeCloseTo(0.413)
  })

  it('never shows overflow percent as ring label', () => {
    const u = agentContextUsage({
      used_tokens: 501599,
      window_tokens: 262144,
      used_percent: 191.3,
      estimated: true,
      anomaly: 'current_context_exceeds_window',
    })
    expect(u.pct).toBeGreaterThan(100)
    expect(contextRingLabel(u)).toBe('!')
    expect(contextRingFillRatio(u)).toBe(1)
  })
})
