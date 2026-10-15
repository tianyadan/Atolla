import { beforeEach, describe, expect, it } from 'vitest'
import {
  collapseStorageKey,
  loadCollapsedFolders,
  saveCollapsedFolders,
} from './folderCollapse'

/** Minimal localStorage stub for Node vitest */
function installMemoryStorage() {
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
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })
}

describe('folderCollapse persistence', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('loads empty set when nothing stored', () => {
    expect([...loadCollapsedFolders('i1')]).toEqual([])
  })

  it('round-trips collapsed keys', () => {
    saveCollapsedFolders('i1', new Set(['root', 'f:2']))
    expect([...loadCollapsedFolders('i1')].sort()).toEqual(['f:2', 'root'])
    expect(localStorage.getItem(collapseStorageKey('i1'))).toContain('root')
  })

  it('isolates instances', () => {
    saveCollapsedFolders('a', new Set(['root']))
    saveCollapsedFolders('b', new Set(['f:1']))
    expect([...loadCollapsedFolders('a')]).toEqual(['root'])
    expect([...loadCollapsedFolders('b')]).toEqual(['f:1'])
  })
})
