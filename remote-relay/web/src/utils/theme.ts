import { restoreStatusBarForTheme } from '../nativeShell'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'relay_theme'

/** Read persisted theme; default follow system then dark-leaning for instances */
export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

/** Apply theme class on <html> (global CSS variables) */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  root.classList.remove('theme-light', 'theme-dark', 'force-light')
  root.classList.add(mode === 'light' ? 'theme-light' : 'theme-dark')
  root.style.colorScheme = mode
}

/** Persist + apply */
export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
  applyTheme(mode)
  // 原生壳：亮色用深色状态栏图标，暗色用浅色图标
  void restoreStatusBarForTheme()
}

/** Toggle light ↔ dark */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === 'light' ? 'dark' : 'light'
  setTheme(next)
  return next
}

/** Boot theme as early as possible */
export function initTheme(): ThemeMode {
  const mode = getStoredTheme()
  applyTheme(mode)
  return mode
}
