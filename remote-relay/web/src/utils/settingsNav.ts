/** Persist Settings back target so「从哪来回哪去」survives secondary settings pages. */

const STORAGE_KEY = 'relay_settings_back'

/** Remember where Settings should return (path + optional query, must start with /) */
export function rememberSettingsBack(path: string): void {
  const next = String(path || '').trim()
  if (!next.startsWith('/')) return
  try {
    sessionStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode */
  }
}

/** Read Settings back target; fallback when opened without a remembered origin */
export function peekSettingsBack(fallback = '/instances'): string {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw && raw.startsWith('/')) return raw
  } catch {
    /* ignore */
  }
  return fallback
}

/** Clear remembered back target (e.g. after logout) */
export function clearSettingsBack(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
