/** 工作站界面语言：仅 zh-CN / en，默认简体中文。 */
export const LOCALE_KEY = 'atolla_locale_v1'
export const LOCALES = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
]

const listeners = new Set()

/** 规范化并校验语言 id */
export function normalizeLocale(raw) {
  const v = String(raw || '').trim()
  if (v === 'en' || v === 'en-US' || v === 'en-GB') return 'en'
  return 'zh-CN'
}

/** 读取当前语言 */
export function getLocale() {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_KEY))
  } catch {
    return 'zh-CN'
  }
}

/** 写入语言并通知订阅者 */
export function setLocale(next) {
  const locale = normalizeLocale(next)
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    /* ignore quota */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  }
  listeners.forEach((cb) => {
    try {
      cb()
    } catch {
      /* ignore listener errors */
    }
  })
  return locale
}

/** 订阅语言变更（useSyncExternalStore） */
export function subscribeLocale(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 启动时同步 html lang */
export function initLocale() {
  const locale = getLocale()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  }
  return locale
}
