/** localStorage：App 壳内中继 API 根地址（如 https://relay.example.com） */
export const API_BASE_KEY = 'relay_api_base'

/** 是否在 Capacitor 原生壳内（非系统 Safari） */
export function isNativeApp(): boolean {
  try {
    // 动态检测，避免非原生构建强依赖 Capacitor
    const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }
    return !!g.Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

/** 读取 API 根；浏览器开发默认空（走同域 / Vite 代理） */
export function getApiBase(): string {
  if (typeof window === 'undefined') return ''
  try {
    const saved = localStorage.getItem(API_BASE_KEY)
    if (saved && saved.trim()) return normalizeBase(saved)
  } catch {
    /* ignore */
  }
  const env = import.meta.env?.VITE_API_BASE
  if (typeof env === 'string' && env.trim()) return normalizeBase(env)
  return ''
}

/** 持久化 API 根；传空则清除 */
export function setApiBase(url: string): void {
  const next = normalizeBase(url)
  try {
    if (!next) localStorage.removeItem(API_BASE_KEY)
    else localStorage.setItem(API_BASE_KEY, next)
  } catch {
    /* ignore */
  }
}

/** 把相对 /api 路径拼成可请求的绝对 URL */
export function resolveApiUrl(path: string): string {
  const base = getApiBase()
  if (!base) return path
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/')) return `${base}${path}`
  return `${base}/${path}`
}

function normalizeBase(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
}
