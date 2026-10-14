import { describe, expect, it } from 'vitest'
import { pageChangelog, parseChangelog } from './changelog.js'

const FIXTURE = `# Atolla Remote Relay 变更历史

## v0.0.2 — 2026-10-13

- 设置页与更新记录
- 实例宫格与对话

## v0.0.1 — 2026-10-12

- 实例 unlock
- 注销 Modal
`

describe('parseChangelog', () => {
  it('parses versions newest-first with bullets', () => {
    const entries = parseChangelog(FIXTURE)
    expect(entries).toEqual([
      {
        version: 'v0.0.2',
        date: '2026-10-13',
        items: ['设置页与更新记录', '实例宫格与对话'],
      },
      {
        version: 'v0.0.1',
        date: '2026-10-12',
        items: ['实例 unlock', '注销 Modal'],
      },
    ])
  })

  it('returns empty array for empty or invalid markdown', () => {
    expect(parseChangelog('')).toEqual([])
    expect(parseChangelog('# only title')).toEqual([])
  })
})

describe('pageChangelog', () => {
  it('returns first page and next_cursor', () => {
    const entries = parseChangelog(FIXTURE)
    const page = pageChangelog(entries, undefined, 1)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].version).toBe('v0.0.2')
    expect(page.next_cursor).toBe('v0.0.2')
    expect(page.has_more).toBe(true)
  })

  it('continues after cursor', () => {
    const entries = parseChangelog(FIXTURE)
    const page = pageChangelog(entries, 'v0.0.2', 10)
    expect(page.items.map((e) => e.version)).toEqual(['v0.0.1'])
    expect(page.has_more).toBe(false)
    expect(page.next_cursor).toBeNull()
  })
})
