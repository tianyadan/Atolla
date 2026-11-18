import { beforeEach, describe, expect, it } from 'vitest'
import { resetLaunchUrlConsumedForTests, shouldOpenUrl } from './NativeDeepLinkHost'

describe('native deep-link delivery dedupe', () => {
  beforeEach(() => resetLaunchUrlConsumedForTests())

  it('drops duplicate launch and appUrlOpen delivery within two seconds', () => {
    const url = 'atolla://agent/mac/7/chat'
    expect(shouldOpenUrl(url, 1_000)).toBe(true)
    expect(shouldOpenUrl(url, 2_500)).toBe(false)
    expect(shouldOpenUrl(url, 3_001)).toBe(true)
  })

  it('does not suppress a different destination', () => {
    expect(shouldOpenUrl('atolla://agent/mac/7/chat', 1_000)).toBe(true)
    expect(shouldOpenUrl('atolla://agent/mac/8/chat', 1_001)).toBe(true)
  })
})
