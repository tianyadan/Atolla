import { LOCALES, type LocaleId } from '../i18n/locale'
import { getApiBase } from './apiBase'

/** Locale id → display label (English / 简体中文) */
export function localeDisplayLabel(locale: string): string {
  const hit = LOCALES.find((item) => item.id === locale)
  return hit?.label || locale
}

/** Resolve current locale label for Settings summary */
export function currentLocaleLabel(locale: LocaleId | string): string {
  return localeDisplayLabel(locale)
}

/**
 * Compact API base for Settings summary: host[:port]
 * Falls back to full string when URL parse fails.
 */
export function formatApiBaseSummary(raw?: string): string {
  const base = String(raw ?? getApiBase()).trim()
  if (!base) return '—'
  try {
    const withProto = /^https?:\/\//i.test(base) ? base : `https://${base}`
    const u = new URL(withProto)
    if (u.port) return `${u.hostname}:${u.port}`
    return u.hostname || base
  } catch {
    return base.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || '—'
  }
}

/** Masked email summary or dash */
export function formatEmailSummary(masked?: string, email?: string): string {
  const v = String(masked || email || '').trim()
  return v || '—'
}

/** Basic URL validation for relay API base (empty allowed = clear) */
export function validateApiBase(raw: string): string | null {
  const v = String(raw || '').trim()
  if (!v) return null
  try {
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`
    const u = new URL(withProto)
    if (!u.hostname) return 'Invalid URL'
    return null
  } catch {
    return 'Invalid URL'
  }
}
