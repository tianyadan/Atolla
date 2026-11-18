import { describe, expect, it } from 'vitest'
import { resolveRestoreInstanceId } from './restoreTarget'

describe('resolveRestoreInstanceId', () => {
  it('prefers the QR-bound LAN instance over a stale cloud chat target', () => {
    expect(resolveRestoreInstanceId({
      routeInstanceId: '',
      lanSessionInstanceId: 'mac-lan',
      lastChatInstanceId: 'mac-cloud',
    })).toBe('mac-lan')
  })

  it('keeps an explicit instance route above the LAN session', () => {
    expect(resolveRestoreInstanceId({
      routeInstanceId: 'mac-route',
      lanSessionInstanceId: 'mac-lan',
      lastChatInstanceId: 'mac-cloud',
    })).toBe('mac-route')
  })
})
