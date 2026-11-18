import { describe, expect, it } from 'vitest'
import {
  clearEnginesUsageCacheForTest,
  enginesUsageCacheFresh,
  peekEnginesUsageCache,
  rememberEnginesUsage,
  type EnginesUsageResponse,
} from './engineUsage'

const usage: EnginesUsageResponse = { engines: [{ id: 'codex', ok: true, windows: [] }] }

describe('engine usage cache', () => {
  it('never reuses a cloud instance quota for a paired LAN instance', () => {
    clearEnginesUsageCacheForTest()
    rememberEnginesUsage(usage, { instanceId: 'cloud-instance', publishNative: false })

    expect(enginesUsageCacheFresh(60_000, 'cloud-instance')).toBe(true)
    expect(peekEnginesUsageCache('lan-instance')).toBeNull()
    expect(enginesUsageCacheFresh(60_000, 'lan-instance')).toBe(false)
  })
})
