import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'
const ENGINE_USAGE_ID = { agent: 'cursor', cursor: 'cursor', codex: 'codex', claude: 'claude' }

function clampPercent(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function usageTone(percent) {
  if (percent >= 90) return 'hot'
  if (percent >= 70) return 'warm'
  return 'ok'
}

function engineName(engineId) {
  return ({ codex: 'Codex', cursor: 'Cursor', claude: 'Claude' })[engineId] || engineId
}

/**
 * 顶栏只保留一个最有参考价值的主窗口：Codex/Claude 优先短周期，Cursor 优先 Auto。
 * 详情弹窗不做字段白名单，服务端新增第三方 API、Grok 等窗口后会自动展示。
 */
function selectPrimaryWindow(engineId, windows) {
  const list = Array.isArray(windows) ? windows : []
  if (engineId === 'cursor') {
    return list.find((item) => /auto/i.test(`${item.kind || ''} ${item.label || ''}`)) || list[0] || null
  }
  return list.find((item) => item.kind === 'session' || /5\s*小时/i.test(item.label || '')) || list[0] || null
}

function formatResetAt(value) {
  const time = new Date(value || '')
  if (Number.isNaN(time.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(time).replaceAll('/', '-')
}

/** 用量窗口标签本地化（服务端仍可能返回中文 label） */
function localizedWindowLabel(item, t) {
  const kind = String(item?.kind || '')
  const label = String(item?.label || '')
  if (kind === 'monthly' || label === '月度') return t('usage.monthly')
  if (/auto/i.test(`${kind} ${label}`) || label === 'Auto 模型') return t('usage.auto')
  return label || kind
}

function localizedWindowHint(item, t) {
  const kind = String(item?.kind || '')
  const label = String(item?.label || '')
  const hint = String(item?.hint || '')
  if (kind === 'monthly' || label === '月度' || hint.includes('账单周期')) return t('usage.hint.monthly')
  if (/auto/i.test(`${kind} ${label}`) || hint.includes('Auto')) return t('usage.hint.auto')
  return hint
}

function resetDescription(item, t) {
  const resetAt = formatResetAt(item?.resets_at)
  if (!resetAt) return item?.reset_hint || ''
  return item?.kind === 'weekly' || /7\s*天/.test(item?.label || '')
    ? t('usage.resetWeekly', { time: resetAt })
    : t('usage.resetNext', { time: resetAt })
}

/** 新版对话顶部的当前引擎额度入口。服务端已有 5 分钟聚合缓存，避免频繁请求外部服务。 */
export default function EngineUsageChip({ engine, authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const engineId = ENGINE_USAGE_ID[String(engine || '').trim().toLowerCase()] || ''
  const [usage, setUsage] = useState(null)
  const [cachedAt, setCachedAt] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const authHeadersRef = useRef(authHeaders)
  const onUnauthorizedRef = useRef(onUnauthorized)

  useEffect(() => {
    authHeadersRef.current = authHeaders
    onUnauthorizedRef.current = onUnauthorized
  }, [authHeaders, onUnauthorized])

  const loadUsage = useCallback(async (force = false) => {
    if (!engineId || typeof authHeadersRef.current !== 'function') return
    setRefreshing(force)
    try {
      const query = force ? '?fresh=1' : ''
      const response = await fetch(`${API}/admin/engines/usage${query}`, { headers: authHeadersRef.current() })
      if (response.status === 401) {
        onUnauthorizedRef.current?.()
        return
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `用量加载失败(${response.status})`)
      setUsage((data.engines || []).find((item) => item?.id === engineId) || null)
      setCachedAt(data.cached_at || '')
    } catch {
      // 顶栏属于辅助信息；接口不可用时不打断对话，仅在弹窗中给出状态。
      setUsage({ id: engineId, ok: false, error: t('usage.unavailable') })
      setCachedAt('')
    } finally {
      setRefreshing(false)
    }
  }, [engineId, t])

  useEffect(() => {
    if (!active || !engineId || typeof authHeadersRef.current !== 'function') return undefined
    void loadUsage(false)
  }, [active, engineId, loadUsage])

  const windows = usage?.ok && Array.isArray(usage.windows) ? usage.windows : []
  const primary = selectPrimaryWindow(engineId, windows)
  const percent = primary ? clampPercent(primary.used_percent) : 0
  if (!engineId) return null

  const primaryLabel = primary
    ? localizedWindowLabel(primary, t)
    : (usage ? t('usage.label') : t('usage.reading'))

  return (
    <div
      className="ma-engine-usage-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className={`ma-engine-usage-chip${primary ? '' : ' is-unavailable'}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={localizedWindowHint(primary, t) || usage?.error || t('usage.title', { name: engineName(engineId) })}
      >
        <span className="ma-engine-usage-copy">
          <b>{engineName(engineId)}</b>
          <em>{primaryLabel}</em>
        </span>
        <span className="ma-engine-usage-track" aria-hidden="true">
          <i className={`tone-${usageTone(percent)}`} style={{ width: `${percent}%` }} />
        </span>
        <strong>{primary ? `${percent}%` : '—'}</strong>
      </button>

      {open && (
        <section className="ma-engine-usage-pop" role="dialog" aria-label={t('usage.title', { name: engineName(engineId) })}>
          <div className="ma-engine-usage-pop-head">
            <div>
              <strong>{t('usage.title', { name: engineName(engineId) })}</strong>
              <span>{usage?.plan ? t('usage.plan', { plan: usage.plan }) : t('usage.subscription')}</span>
            </div>
            <div className="ma-engine-usage-pop-actions">
              <button type="button" className="ma-engine-usage-refresh" onClick={() => void loadUsage(true)} disabled={refreshing}>
                {refreshing ? t('usage.refreshing') : t('usage.refresh')}
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('usage.close')}>×</button>
            </div>
          </div>
          {windows.length > 0 ? (
            <ul className="ma-engine-usage-list">
              {windows.map((item) => {
                const itemPercent = clampPercent(item.used_percent)
                const hint = localizedWindowHint(item, t)
                const reset = resetDescription(item, t)
                return (
                  <li key={`${item.kind}-${item.label}`}>
                    <div>
                      <strong>{localizedWindowLabel(item, t)}</strong>
                      <span>{t('usage.used', { pct: itemPercent })}</span>
                    </div>
                    <span className="ma-engine-usage-track is-large"><i className={`tone-${usageTone(itemPercent)}`} style={{ width: `${itemPercent}%` }} /></span>
                    {(hint || reset) && <small>{[hint, reset].filter(Boolean).join(' · ')}</small>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="ma-engine-usage-empty">{usage?.error || (!usage ? t('usage.loading') : t('usage.empty'))}</p>
          )}
          {(usage?.source || cachedAt) && (
            <p className="ma-engine-usage-source">
              {usage?.source ? t('usage.source', { source: usage.source }) : ''}
              {cachedAt
                ? `${usage?.source ? ' · ' : ''}${t('usage.updatedAt', { time: formatResetAt(cachedAt) })}`
                : ''}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
