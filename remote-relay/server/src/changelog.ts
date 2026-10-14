import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** One CHANGELOG section */
export type ChangelogEntry = {
  version: string
  date: string
  items: string[]
}

/** Cursor page of changelog entries */
export type ChangelogPage = {
  items: ChangelogEntry[]
  next_cursor: string | null
  has_more: boolean
}

/**
 * Parse remote-relay CHANGELOG.md sections.
 * Expects `## vX.Y.Z — YYYY-MM-DD` headings and `- ` bullets.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const lines = md.split(/\r?\n/)
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null

  const heading = /^##\s+(v[\d.]+)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/
  for (const raw of lines) {
    const line = raw.trimEnd()
    const hm = heading.exec(line.trim())
    if (hm) {
      if (current) entries.push(current)
      current = { version: hm[1], date: hm[2], items: [] }
      continue
    }
    if (!current) continue
    const bullet = /^-\s+(.+)$/.exec(line.trim())
    if (bullet) current.items.push(bullet[1].trim())
  }
  if (current) entries.push(current)
  return entries
}

/** Page entries after optional cursor (exclusive); newest-first list */
export function pageChangelog(
  entries: ChangelogEntry[],
  cursor: string | undefined,
  limit: number,
): ChangelogPage {
  const safeLimit = Math.max(1, Math.min(limit || 10, 50))
  let start = 0
  if (cursor?.trim()) {
    const idx = entries.findIndex((e) => e.version === cursor.trim())
    start = idx >= 0 ? idx + 1 : entries.length
  }
  const slice = entries.slice(start, start + safeLimit)
  const hasMore = start + slice.length < entries.length
  const last = slice[slice.length - 1]
  return {
    items: slice,
    next_cursor: hasMore && last ? last.version : null,
    has_more: hasMore,
  }
}

/** Resolve CHANGELOG.md next to remote-relay package root */
export function resolveChangelogPath(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(moduleDir, '../../CHANGELOG.md'),
    path.resolve(process.cwd(), 'CHANGELOG.md'),
    path.resolve(process.cwd(), '../CHANGELOG.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Load and parse changelog from disk; empty on missing/error */
export function loadChangelogEntries(): ChangelogEntry[] {
  const p = resolveChangelogPath()
  if (!p) {
    console.warn('[remote-relay] CHANGELOG.md not found')
    return []
  }
  try {
    return parseChangelog(fs.readFileSync(p, 'utf8'))
  } catch (err) {
    console.warn('[remote-relay] failed to read CHANGELOG.md', err)
    return []
  }
}

/** App version from package.json (server workspace) */
export function loadPackageVersion(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(moduleDir, '../package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ]
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: string }
      if (raw.version?.trim()) return raw.version.trim()
    } catch {
      /* try next */
    }
  }
  return '0.0.0'
}
