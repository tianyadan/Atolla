import { useCallback, useEffect, useMemo, useState } from 'react'

const API = '/api'
const START_DAY = '2026-01-01'

const ENGINE_TABS = [
  { key: 'all', label: '全部引擎', tone: 'all' },
  { key: 'codex', label: 'Codex', tone: 'codex' },
  { key: 'claude', label: 'Claude', tone: 'claude' },
  { key: 'cursor', label: 'Cursor', tone: 'cursor' },
]

function dayKey(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00`)
}

function mondayIndex(date) {
  return (date.getDay() + 6) % 7
}

/** 从固定起点生成完整周，保证每次刷新热力图列的位置不跳动。 */
export function buildHeatmapDays(items, today = new Date()) {
  const usageByDay = new Map((items || []).map((item) => [item.date, item]))
  const start = dateFromKey(START_DAY)
  start.setDate(start.getDate() - mondayIndex(start))
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKey(cursor)
    const record = usageByDay.get(key)
    days.push({
      date: key,
      tokens: Number(record?.total_tokens) || 0,
      estimated: Boolean(record?.estimated),
      beforeStart: key < START_DAY,
    })
  }
  return days
}

export function formatTokenWan(tokens) {
  const value = Math.max(0, Number(tokens) || 0) / 10_000
  if (value === 0) return '0w'
  const digits = value >= 10 ? 0 : 1
  return `${value.toFixed(digits).replace(/\.0$/, '')}w`
}

function levelFor(tokens, max) {
  if (!tokens || !max) return 0
  // 对数分段让少量日用量不会全部挤在最浅一级。
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(tokens) / Math.log1p(max)) * 4)))
}

export default function ProfileTokenUsage({ authHeaders, onUnauthorized, active }) {
  const [engine, setEngine] = useState('all')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ engine, from: START_DAY })
      const response = await fetch(`${API}/admin/profile/token-usage?${query}`, { headers: authHeaders() })
      if (response.status === 401) {
        onUnauthorized?.()
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '读取 Token 用量失败')
      setItems(Array.isArray(body.items) ? body.items : [])
    } catch (requestError) {
      setError(String(requestError?.message || requestError))
    } finally {
      setLoading(false)
    }
  }, [active, authHeaders, engine, onUnauthorized])

  useEffect(() => { load() }, [load])

  const heatmap = useMemo(() => buildHeatmapDays(items), [items])
  const max = useMemo(() => heatmap.reduce((highest, day) => Math.max(highest, day.tokens), 0), [heatmap])
  const months = useMemo(() => heatmap.map((day, index) => {
    const date = dateFromKey(day.date)
    const isFirstDayOfMonth = date.getDate() === 1 && !day.beforeStart
    return isFirstDayOfMonth ? { index: Math.floor(index / 7), label: `${date.getMonth() + 1}月` } : null
  }).filter(Boolean), [heatmap])
  const selectedTab = ENGINE_TABS.find((tab) => tab.key === engine) || ENGINE_TABS[0]

  return (
    <section className={`profile-token-panel profile-tone-${selectedTab.tone}`} aria-busy={loading}>
      <header className="profile-token-toolbar">
        <div className="profile-engine-tabs" role="tablist" aria-label="Token 用量引擎筛选">
          {ENGINE_TABS.map((tab) => (
            <button
              type="button"
              key={tab.key}
              role="tab"
              aria-selected={engine === tab.key}
              className={`profile-engine-tab tone-${tab.tone}${engine === tab.key ? ' is-active' : ''}`}
              onClick={() => setEngine(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="profile-token-error" role="alert">{error}</p>}
      <div className="profile-heatmap-scroll">
        <div className="profile-heatmap" aria-label="从 2026 年开始的每日 Token 用量热力图">
          <div className="profile-months" aria-hidden="true">
            {months.map((month) => <span key={`${month.index}-${month.label}`} style={{ '--month-week': month.index }}>{month.label}</span>)}
          </div>
          <div className="profile-heatmap-body">
            <div className="profile-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span></div>
            <div className="profile-heatmap-grid">
              {heatmap.map((day) => (
                <span
                  key={day.date}
                  className={`profile-day level-${day.beforeStart ? 0 : levelFor(day.tokens, max)}${day.estimated ? ' is-estimated' : ''}`}
                  data-tooltip={day.beforeStart ? '' : `${day.date} · ${formatTokenWan(day.tokens)}`}
                  aria-label={day.beforeStart ? undefined : `${day.date}，${formatTokenWan(day.tokens)}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <footer className="profile-heatmap-foot">
        <span className="profile-legend" aria-label="用量由低到高"><i className="level-0" />少<i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" />多</span>
      </footer>
    </section>
  )
}
