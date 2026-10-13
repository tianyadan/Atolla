import { useEffect, useState } from 'react'

const API = '/api'

const ENGINES = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'agent', label: 'Cursor' },
]

const BUILTIN_SKILL_ICON = {
  database: '/skill-icons/database.svg',
  server: '/skill-icons/server.svg',
  browser: '/skill-icons/browser.svg',
  coding: null,
  shell: null,
  search: null,
}

/** 技能小图标 */
function SkillChip({ skill }) {
  const src = skill.icon_url || BUILTIN_SKILL_ICON[skill.icon_key]
  return (
    <span className="tm-skill-chip" title={skill.summary || skill.name}>
      {src ? <img src={src} alt="" /> : <span className="tm-skill-glyph">◇</span>}
      <span>{skill.name}</span>
    </span>
  )
}

/**
 * 人才市场：预制岗位卡片 → 详情（提示词/技能/引擎自选）→ 招聘；右上角自定义招聘。
 */
export default function TalentMarket({
  open,
  authHeaders,
  onUnauthorized,
  onClose,
  onHired,
  onCustomHire,
}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)
  const [engine, setEngine] = useState('claude')
  const [name, setName] = useState('')
  const [contextWindow, setContextWindow] = useState(1000000)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr('')
      setDetail(null)
      try {
        const res = await fetch(`${API}/admin/talent-market`, { headers: authHeaders() })
        if (res.status === 401) { onUnauthorized?.(); return }
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || '加载人才市场失败')
        if (!cancelled) setItems(d.items || [])
      } catch (e) {
        if (!cancelled) setErr(String(e.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, authHeaders, onUnauthorized])

  /** 打开人才详情 */
  async function openDetail(id) {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/talent-market/${encodeURIComponent(id)}`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '加载人才详情失败')
      setDetail(d)
      setName(d.name || '')
      setEngine(d.default_engine || 'claude')
      setContextWindow(1000000)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  /** 确认招聘：入职后提示词/技能仍可在设置中调整 */
  async function hire() {
    if (!detail || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/talent-market/hire`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          talent_id: detail.id,
          name: name.trim() || detail.name,
          engine,
          context_window_tokens: contextWindow,
        }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '招聘失败')
      onHired?.(d)
      onClose?.()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-mask" onClick={() => !busy && onClose?.()}>
      <div className={`modal-card tm-modal ${detail ? 'tm-modal-detail' : ''}`} onClick={(e) => e.stopPropagation()}>
        {!detail ? (
          <>
            <div className="tm-head">
              <div>
                <h2>人才市场</h2>
                <p className="tm-sub">官方预制岗位 · 技能随商店动态更新 · 入职后可改提示词与技能</p>
              </div>
              <button type="button" className="ghost" disabled={busy} onClick={() => onCustomHire?.()}>
                自定义招聘
              </button>
            </div>
            {err && <p className="tm-err">{err}</p>}
            {loading && <p className="empty">加载中…</p>}
            {!loading && (
              <div className="tm-grid">
                {items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="tm-card"
                    disabled={busy}
                    onClick={() => openDetail(t.id)}
                  >
                    <img className="tm-avatar" src={t.avatar_url} alt="" />
                    <strong className="tm-name">{t.name}</strong>
                    <span className="tm-title">{t.title}</span>
                    <p className="tm-summary">{t.summary}</p>
                    <span className="skill-count-badge" title="匹配到的技能数">{t.skill_count || 0}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => onClose?.()}>关闭</button>
            </div>
          </>
        ) : (
          <>
            <div className="tm-head">
              <div className="tm-detail-identity">
                <img className="tm-avatar tm-avatar-lg" src={detail.avatar_url} alt="" />
                <div>
                  <h2>{detail.name}</h2>
                  <p className="tm-title">{detail.title}</p>
                </div>
              </div>
              <button type="button" className="ghost" disabled={busy} onClick={() => setDetail(null)}>返回市场</button>
            </div>
            {err && <p className="tm-err">{err}</p>}
            <p className="tm-summary tm-summary-block">{detail.summary}</p>
            {!!detail.highlights?.length && (
              <div className="tm-section">
                <h3>擅长</h3>
                <ul className="tm-highlights">
                  {detail.highlights.map((h) => <li key={h}>{h}</li>)}
                </ul>
              </div>
            )}
            <div className="tm-section">
              <h3>自带技能（动态匹配商店）</h3>
              <div className="tm-skills">
                {(detail.skills || []).length === 0
                  ? <p className="muted">当前商店暂无匹配技能</p>
                  : detail.skills.map((sk) => <SkillChip key={sk.id} skill={sk} />)}
              </div>
            </div>
            <div className="tm-section">
              <h3>岗位提示词</h3>
              <pre className="tm-prompt">{detail.rules_prompt}</pre>
              <p className="muted tm-hint">招聘后可在员工设置中随时修改提示词与技能。</p>
            </div>
            <div className="tm-form-row">
              <label>
                显示名称
                <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                引擎
                <select value={engine} disabled={busy} onChange={(e) => setEngine(e.target.value)}>
                  {ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </label>
              <label>
                上下文窗口
                <select value={contextWindow} disabled={busy} onChange={(e) => setContextWindow(Number(e.target.value))}>
                  <option value={262144}>256K</option>
                  <option value={524288}>512K</option>
                  <option value={1000000}>1M</option>
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setDetail(null)}>返回</button>
              <button type="button" className="primary" disabled={busy} onClick={hire}>
                {busy ? '招聘中…' : '确认招聘'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
