export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8080'
export const DEFAULT_ALLOWED_DOMAINS = ['localhost', '127.0.0.1', 'chatgpt.com', 'chat.openai.com']

export function normalizeBackendURL(value) {
  const raw = String(value || DEFAULT_BACKEND_URL).trim()
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('后端地址只支持 http/https')
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('扩展仅连接本机 Atolla 后端')
  }
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function websocketURL(backendURL) {
  const url = new URL(normalizeBackendURL(backendURL))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/browser/ws'
  return url.toString()
}

export function normalizeDomains(domains) {
  const values = Array.isArray(domains) ? domains : String(domains || '').split(',')
  const cleaned = [...new Set(values.map((item) => String(item).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))]
  return cleaned.length ? cleaned : [...DEFAULT_ALLOWED_DOMAINS]
}

export function isAllowedURL(rawURL, domains) {
  let url
  try {
    url = new URL(String(rawURL || ''))
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return normalizeDomains(domains).some((rule) => {
    if (rule.startsWith('*.')) {
      const base = rule.slice(2)
      return host !== base && host.endsWith(`.${base}`)
    }
    return host === rule
  })
}

export function clampTimeout(value) {
  const timeout = Number(value) || 15000
  return Math.max(100, Math.min(300000, timeout))
}

export function serializableError(error, fallback = 'BROWSER_ACTION_FAILED') {
  return {
    error: error instanceof Error ? error.message : String(error || '浏览器操作失败'),
    code: error?.code || fallback,
    ...(error?.data !== undefined ? { data: error.data } : {}),
  }
}
