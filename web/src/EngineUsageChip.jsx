import { useEffect, useState } from 'react'

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

/** 新版对话顶部的当前引擎额度入口。服务端已有 5 分钟聚合缓存，避免频繁请求外部服务。 */
export default function EngineUsageChip({ engine, authHeaders, onUnauthorized, active }) {
  const engineId = ENGINE_USAGE_ID[String(engine || '').trim().toLowerCase()] || ''
  const [usage, setUsage] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!active || !engineId || typeof authHeaders !== 'function') return undefined
    let cancelled = false
    fetch(`${API}/admin/engines/usage`, { headers: authHeaders() })
      .then(async (response) => {
        if (response.status === 401) {
          onUnauthorized?.()
          return null
        }
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `用量加载失败(${response.status})`)
        return (data.engines || []).find((item) => item?.id === engineId) || null
      })
      .then((item) => {
        if (!cancelled) setUsage(item)
      })
      .catch(() => {
        // 顶栏属于辅助信息；接口不可用时不打断对话，仅在弹窗中给出状态。
        if (!cancelled) setUsage({ id: engineId, ok: false, error: '暂时无法读取用量' })
      })
    return () => { cancelled = true }
  }, [active, authHeaders, engineId, onUnauthorized])

  const windows = usage?.ok && Array.isArray(usage.windows) ? usage.windows : []
  const primary = selectPrimaryWindow(engineId, windows)
  const percent = primary ? clampPercent(primary.used_percent) : 0
  if (!engineId) return null

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
        title={primary?.hint || usage?.error || `${engineName(engineId)} 用量`}
      >
        <span className="ma-engine-usage-copy">
          <b>{engineName(engineId)}</b>
          <em>{primary ? (primary.label || primary.kind) : (usage ? '用量' : '读取中')}</em>
        </span>
        <span className="ma-engine-usage-track" aria-hidden="true">
          <i className={`tone-${usageTone(percent)}`} style={{ width: `${percent}%` }} />
        </span>
        <strong>{primary ? `${percent}%` : '—'}</strong>
      </button>

      {open && (
        <section className="ma-engine-usage-pop" role="dialog" aria-label={`${engineName(engineId)} 用量详情`}>
          <div className="ma-engine-usage-pop-head">
            <div>
              <strong>{engineName(engineId)} 用量</strong>
              <span>{usage?.plan ? `套餐 ${usage.plan}` : '当前订阅额度'}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭用量详情">×</button>
          </div>
          {windows.length > 0 ? (
            <ul className="ma-engine-usage-list">
              {windows.map((item) => {
                const itemPercent = clampPercent(item.used_percent)
                return (
                  <li key={`${item.kind}-${item.label}`}>
                    <div><strong>{item.label || item.kind}</strong><span>{itemPercent}% 已用</span></div>
                    <span className="ma-engine-usage-track is-large"><i className={`tone-${usageTone(itemPercent)}`} style={{ width: `${itemPercent}%` }} /></span>
                    {(item.hint || item.reset_hint) && <small>{[item.hint, item.reset_hint].filter(Boolean).join(' · ')}</small>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="ma-engine-usage-empty">{usage?.error || (!usage ? '正在读取用量…' : '暂未返回可展示的额度窗口')}</p>
          )}
          {usage?.source && <p className="ma-engine-usage-source">数据源 · {usage.source}</p>}
        </section>
      )}
    </div>
  )
}
