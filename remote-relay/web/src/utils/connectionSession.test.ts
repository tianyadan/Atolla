import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearConnectionSession,
  getConnectionSession,
  hasAuthenticatedConnection,
  hasLanInstanceAccess,
  invalidateRevokedLanSession,
  startLanConnectionSession,
} from './connectionSession'
import { clearLanConnection, saveLanConnection } from './lanConnection'

describe('connection session', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size },
    })
  })

  it('accepts a paired LAN instance without a cloud token', () => {
    saveLanConnection({
      instanceId: 'mac-1',
      baseUrl: 'http://192.168.1.20:7943',
      deviceId: 'iphone-1',
      deviceSecret: 'device-secret',
      strategy: 'lan_only',
    })

    startLanConnectionSession('mac-1')

    expect(getConnectionSession()).toEqual({ mode: 'lan', instanceId: 'mac-1' })
    expect(hasAuthenticatedConnection(null)).toBe(true)
    expect(hasLanInstanceAccess('mac-1')).toBe(true)
    expect(hasLanInstanceAccess('mac-2')).toBe(false)
  })

  it('does not trust a stale session when its pairing is removed', () => {
    saveLanConnection({
      instanceId: 'mac-1',
      baseUrl: 'http://192.168.1.20:7943',
      deviceId: 'iphone-1',
      deviceSecret: 'device-secret',
      strategy: 'lan_only',
    })
    startLanConnectionSession('mac-1')
    clearLanConnection('mac-1')

    expect(hasAuthenticatedConnection(null)).toBe(false)
    expect(getConnectionSession()).toBeNull()
  })

  it('forgets a revoked pairing before the route guard can re-enter the app', () => {
    saveLanConnection({
      instanceId: 'mac-1',
      baseUrl: 'http://192.168.1.20:7943',
      deviceId: 'iphone-1',
      deviceSecret: 'device-secret',
      strategy: 'lan_only',
    })
    startLanConnectionSession('mac-1')

    invalidateRevokedLanSession('mac-1')

    expect(getConnectionSession()).toBeNull()
    expect(hasAuthenticatedConnection(null)).toBe(false)
  })

  it('clears only the local session without affecting a remote token decision', () => {
    clearConnectionSession()
    expect(hasAuthenticatedConnection('remote-token')).toBe(true)
    expect(hasAuthenticatedConnection(null)).toBe(false)
  })
})
