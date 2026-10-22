import { describe, expect, it } from 'vitest'
import { resolveApiUrl } from './apiBase'

describe('resolveApiUrl', () => {
  it('keeps relative path when no base configured', () => {
    expect(resolveApiUrl('/api/auth/login')).toBe('/api/auth/login')
  })
})
