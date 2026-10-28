import { useCallback, useSyncExternalStore } from 'react'
import { getLocale, setLocale, subscribeLocale, type LocaleId } from './locale'
import { formatMessage, messages } from './messages'

/** 翻译：缺英文键时回退简体中文 */
export function translate(locale: LocaleId, key: string, vars?: Record<string, string | number>) {
  const table = messages[locale] || messages['zh-CN']
  const raw = table[key] ?? messages['zh-CN'][key] ?? key
  return formatMessage(raw, vars)
}

/** 订阅当前界面语言 */
export function useLocale() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'zh-CN' as LocaleId)
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  )
  return { locale, setLocale, t }
}
