import { describe, expect, it } from 'vitest'
import {
  clearPendingDeepLink,
  deepLinkTargetPath,
  loadPendingDeepLink,
  parseAtollaDeepLink,
  savePendingDeepLink,
  type StorageLike,
} from './deepLink'

function memoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('Atolla deep links', () => {
  it('parses agent and approval links with encoded ids', () => {
    expect(parseAtollaDeepLink('atolla://agent/mac%20office/a%2Fb/chat')).toEqual({
      kind: 'agent', instanceId: 'mac office', agentId: 'a/b',
    })
    expect(parseAtollaDeepLink('atolla://approval/mac%20office/a%2Fb/r%2F1')).toEqual({
      kind: 'approval', instanceId: 'mac office', agentId: 'a/b', requestId: 'r/1',
    })
  })

  it('rejects unknown schemes, paths, and missing segments', () => {
    expect(parseAtollaDeepLink('https://agent/mac/a/chat')).toBeNull()
    expect(parseAtollaDeepLink('atolla://agent/mac/a')).toBeNull()
    expect(parseAtollaDeepLink('atolla://approval/mac/a')).toBeNull()
    expect(parseAtollaDeepLink('not a url')).toBeNull()
  })

  it('builds encoded app routes including approval request id', () => {
    expect(deepLinkTargetPath({ kind: 'agent', instanceId: 'mac 1', agentId: 'a/b' })).toBe(
      '/instances/mac%201/agents/a%2Fb/chat',
    )
    expect(deepLinkTargetPath({ kind: 'approval', instanceId: 'mac 1', agentId: 'a/b', requestId: 'r/1' })).toBe(
      '/instances/mac%201/agents/a%2Fb/chat?approval_request_id=r%2F1',
    )
  })

  it('round-trips and clears pending targets', () => {
    const storage = memoryStorage()
    const target = { kind: 'approval' as const, instanceId: 'mac', agentId: 'a', requestId: 'r' }
    savePendingDeepLink(target, storage)
    expect(loadPendingDeepLink(storage)).toEqual(target)
    clearPendingDeepLink(storage)
    expect(loadPendingDeepLink(storage)).toBeNull()
  })

  it('drops invalid stored data without throwing', () => {
    const storage = memoryStorage()
    storage.setItem('atolla.pendingDeepLink', '{bad json')
    expect(loadPendingDeepLink(storage)).toBeNull()
  })
})
