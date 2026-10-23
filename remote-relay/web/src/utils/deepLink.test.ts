import { describe, expect, it } from 'vitest'
import {
  clearPendingDeepLink,
  deepLinkAgentsPath,
  deepLinkTargetPath,
  isDeepLinkPathActive,
  loadPendingDeepLink,
  navigateToDeepLinkChat,
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

  it('builds agents list path and detects active chat route', () => {
    expect(deepLinkAgentsPath({ instanceId: 'mac 1' })).toBe('/instances/mac%201/agents')
    const target = { kind: 'agent' as const, instanceId: 'mac', agentId: 'a' }
    expect(isDeepLinkPathActive(target, '/instances/mac/agents/a/chat')).toBe(true)
    expect(isDeepLinkPathActive(target, '/instances/mac/agents')).toBe(false)
    const approval = {
      kind: 'approval' as const, instanceId: 'mac', agentId: 'a', requestId: 'r1',
    }
    expect(
      isDeepLinkPathActive(approval, '/instances/mac/agents/a/chat', '?approval_request_id=r1'),
    ).toBe(true)
  })

  it('seeds agents list then chat so back has a stable previous page', () => {
    const calls: Array<{ to: string; replace?: boolean }> = []
    const navigate = (to: string, options?: { replace?: boolean }) => {
      calls.push({ to, replace: options?.replace })
    }
    const target = { kind: 'agent' as const, instanceId: 'mac', agentId: 'a' }
    navigateToDeepLinkChat(navigate, target, { pathname: '/instances', search: '' })
    expect(calls).toEqual([
      { to: '/instances/mac/agents', replace: true },
      { to: '/instances/mac/agents/a/chat', replace: undefined },
    ])
  })

  it('skips navigation when already on the deep-link chat', () => {
    const calls: string[] = []
    const navigate = (to: string) => {
      calls.push(to)
    }
    const target = { kind: 'agent' as const, instanceId: 'mac', agentId: 'a' }
    navigateToDeepLinkChat(navigate, target, {
      pathname: '/instances/mac/agents/a/chat',
      search: '',
    })
    expect(calls).toEqual([])
  })
})
