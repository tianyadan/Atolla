import { describe, expect, it } from 'vitest'
import { deriveRuleAgentStatus } from './siri.js'

describe('Siri rules status provider', () => {
  it.each([
    [{ agentStatus: 'idle' }, 'idle'],
    [{ agentStatus: 'running' }, 'running'],
    [{ agentStatus: 'waiting' }, 'waiting'],
    [{ hasPendingApproval: true }, 'approval'],
    [{ agentStatus: 'compressing' }, 'compressing'],
    [{ agentStatus: 'error' }, 'error'],
    [{ taskStatus: 'done' }, 'completed'],
  ] as const)('maps %o to %s', (input, expected) => {
    expect(deriveRuleAgentStatus(input)).toBe(expected)
  })

  it('keeps error above approval and active states', () => {
    expect(deriveRuleAgentStatus({
      agentStatus: 'running',
      unreadKind: 'error',
      hasPendingApproval: true,
    })).toBe('error')
  })
})
