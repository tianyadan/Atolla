import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatRoute,
  loadInstanceChatSelection,
  loadLastChatSelection,
  rememberChatSelection,
} from './chatResume'

function stubStorage() {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, String(value)),
      removeItem: (key: string) => map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size
      },
    },
    configurable: true,
  })
}

describe('chatResume', () => {
  beforeEach(() => {
    stubStorage()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  })

  it('restores the most recently visited instance and agent', () => {
    rememberChatSelection('mac-a', 'agent-1', 23)
    expect(loadLastChatSelection()).toEqual({
      instanceId: 'mac-a',
      agentId: 'agent-1',
      conversationId: '23',
      updatedAt: 1_700_000_000_000,
    })
  })

  it('keeps each instance selection isolated', () => {
    rememberChatSelection('mac-a', 'agent-a')
    rememberChatSelection('mac-b', 'agent-b')
    expect(loadInstanceChatSelection('mac-a')?.agentId).toBe('agent-a')
    expect(loadInstanceChatSelection('mac-b')?.agentId).toBe('agent-b')
    expect(loadLastChatSelection()?.instanceId).toBe('mac-b')
  })

  it('encodes instance and agent ids in chat routes', () => {
    expect(chatRoute({ instanceId: 'mac office', agentId: '研发/a' })).toBe(
      '/instances/mac%20office/agents/%E7%A0%94%E5%8F%91%2Fa/chat',
    )
  })
})
