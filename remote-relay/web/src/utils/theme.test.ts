import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, getStoredTheme, setTheme, toggleTheme } from './theme'

/** Minimal browser stubs for Node vitest */
function installDomStubs() {
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
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

  const classSet = new Set<string>()
  const el = {
    classList: {
      add: (...xs: string[]) => xs.forEach((x) => classSet.add(x)),
      remove: (...xs: string[]) => xs.forEach((x) => classSet.delete(x)),
      contains: (x: string) => classSet.has(x),
      toggle: (x: string) => {
        if (classSet.has(x)) classSet.delete(x)
        else classSet.add(x)
      },
    },
    style: { colorScheme: '' } as { colorScheme: string },
    get className() {
      return [...classSet].join(' ')
    },
    set className(v: string) {
      classSet.clear()
      String(v)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((x) => classSet.add(x))
    },
  }
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: el },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: {
      matchMedia: () => ({ matches: false }),
    },
    configurable: true,
  })
}

describe('global theme', () => {
  beforeEach(() => {
    installDomStubs()
  })

  it('persists and applies light/dark on html', () => {
    setTheme('light')
    expect(localStorage.getItem('relay_theme')).toBe('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(getStoredTheme()).toBe('light')

    setTheme('dark')
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
  })

  it('toggles between modes', () => {
    applyTheme('dark')
    localStorage.setItem('relay_theme', 'dark')
    expect(toggleTheme()).toBe('light')
    expect(toggleTheme()).toBe('dark')
  })
})
