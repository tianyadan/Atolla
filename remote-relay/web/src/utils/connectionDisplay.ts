import type { LocaleId } from '../i18n/locale'
import { messages } from '../i18n/messages'
import type { LanRouteState } from './lanConnection'

export type ConnectionRouteDisplay = {
  label: string
  tone: 'success' | 'neutral' | 'danger'
}

/** Maps the persisted per-instance transport outcome to concise settings copy. */
export function formatConnectionRoute(
  route: LanRouteState,
  locale: LocaleId = 'zh-CN',
): ConnectionRouteDisplay {
  const copy = messages[locale]
  if (route.channel === 'lan') return { label: copy['settings.connection.lan'], tone: 'success' }
  if (route.channel === 'unavailable') return { label: copy['settings.connection.unavailable'], tone: 'danger' }
  return { label: copy['settings.connection.cloud'], tone: 'neutral' }
}
