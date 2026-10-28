import { useCallback, useSyncExternalStore } from 'react'
import { getLocale, setLocale, subscribeLocale } from './locale.js'
import { formatMessage, messages } from './messages.js'

/** 翻译：缺英文键时回退简体中文 */
export function translate(locale, key, vars) {
  const table = messages[locale] || messages['zh-CN']
  const raw = table[key] ?? messages['zh-CN'][key] ?? key
  return formatMessage(raw, vars)
}

/** 订阅当前界面语言 */
export function useLocale() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'zh-CN')
  const t = useCallback((key, vars) => translate(locale, key, vars), [locale])
  return { locale, setLocale, t }
}
