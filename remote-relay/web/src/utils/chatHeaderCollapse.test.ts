import { beforeEach, describe, expect, it } from 'vitest'
import { loadChatHeaderExpanded, saveChatHeaderExpanded } from './chatHeaderCollapse'

/** Minimal localStorage stub for Node vitest */
function stubStorage() {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })
  return map
}

describe('chatHeaderCollapse', () => {
  beforeEach(() => {
    stubStorage()
  })

  it('defaults to expanded when unset', () => {
    expect(loadChatHeaderExpanded()).toBe(true)
  })

  it('persists collapsed preference', () => {
    saveChatHeaderExpanded(false)
    expect(loadChatHeaderExpanded()).toBe(false)
    saveChatHeaderExpanded(true)
    expect(loadChatHeaderExpanded()).toBe(true)
  })
})
