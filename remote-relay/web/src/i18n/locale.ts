/** App 界面语言：仅 zh-CN / en，默认简体中文。 */
export const LOCALE_KEY = 'atolla_locale_v1'

export const LOCALES = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
] as const

export type LocaleId = (typeof LOCALES)[number]['id']

const listeners = new Set<() => void>()

/** 规范化语言 id */
export function normalizeLocale(raw: unknown): LocaleId {
  const v = String(raw || '').trim()
  if (v === 'en' || v === 'en-US' || v === 'en-GB') return 'en'
  return 'zh-CN'
}

/** 读取当前语言 */
export function getLocale(): LocaleId {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_KEY))
  } catch {
    return 'zh-CN'
  }
}

/** 写入语言并通知订阅者 */
export function setLocale(next: string): LocaleId {
  const locale = normalizeLocale(next)
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  }
  listeners.forEach((cb) => {
    try {
      cb()
    } catch {
      /* ignore */
    }
  })
  return locale
}

/** 订阅语言变更 */
export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 启动时同步 html lang */
export function initLocale(): LocaleId {
  const locale = getLocale()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  }
  return locale
}
