import { describe, expect, it } from 'vitest'
import { clampComposerHeight, formatElapsed } from './composerLayout'

describe('composerLayout', () => {
  it('clamps the textarea height to the native composer range', () => {
    expect(clampComposerHeight(20)).toBe(40)
    expect(clampComposerHeight(88)).toBe(88)
    expect(clampComposerHeight(300)).toBe(160)
  })

  it('formats the compact running elapsed time', () => {
    expect(formatElapsed(8)).toBe('8s')
    expect(formatElapsed(65)).toBe('1m 05s')
  })
})
