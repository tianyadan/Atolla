import { useEffect, useState } from 'react'

const API = '/api'

/**
 * 解聘弹窗：可选保留离职记忆 + 章节多选（默认全选）。
 */
export default function DismissAgentModal({
  open,
  agents = [], // [{id,name}] 支持单个或批量
  authHeaders,
  onUnauthorized,
  onClose,
  onDone,
}) {
  const [keep, setKeep] = useState(true)
  const [sections, setSections] = useState([])
  const [catalog, setCatalog] = useState([])
  const [jobTitle, setJobTitle] = useState('数字员工')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return undefined
    setKeep(true)
    setJobTitle('数字员工')
    setErr('')
    let cancelled = false
    fetch(`${API}/admin/legacy-memories/sections`, { headers: authHeaders() })
      .then((r) => {
        if (r.status === 401) { onUnauthorized?.(); return null }
        return r.json()
      })
      .then((d) => {
        if (cancelled || !d) return
        const list = d.sections || []
        setCatalog(list)
        setSections(list.map((s) => s.id))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, authHeaders, onUnauthorized])

  function toggleSec(id) {
    setSections((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function confirm() {
    if (!agents.length || busy) return
    setBusy(true)
    setErr('')
    try {
      for (const a of agents) {
        const res = await fetch(`${API}/admin/agents/${a.id}/dismiss`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            keep_memory: keep,
            sections: keep ? sections : [],
            job_title: jobTitle.trim() || '数字员工',
          }),
        })
        if (res.status === 401) { onUnauthorized?.(); return }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `解聘 ${a.name} 失败`)
        }
      }
      onDone?.(agents.map((a) => a.id))
      onClose?.()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  const names = agents.map((a) => a.name).join('、')

  return (
    <div className="modal-mask" onClick={() => !busy && onClose?.()}>
      <div className="modal-card ma-settings dismiss-modal" onClick={(e) => e.stopPropagation()}>
        <h2>解聘数字员工</h2>
        <p className="dismiss-lead">
          即将解聘：<strong>{names}</strong>
          {agents.length > 1 ? `（共 ${agents.length} 人）` : ''}
        </p>
        <label className={`auto-switch ma-capsule dismiss-keep ${busy ? 'busy' : ''}`}>
          <span className="dismiss-keep-label">保留数字员工记忆</span>
          <input type="checkbox" checked={keep} disabled={busy} onChange={(e) => setKeep(e.target.checked)} />
          <span className="slider" />
        </label>
        <p className="muted dismiss-hint">
          开启后将异步生成「离职记忆书」，前端立即移除员工；记忆可在「数字员工记忆」书架管理与认领。
        </p>
        {keep && (
          <>
            <label>
              离职岗位
              <input value={jobTitle} disabled={busy} onChange={(e) => setJobTitle(e.target.value)} placeholder="如：前端工程师" />
            </label>
            <div className="dismiss-sections">
              <div className="dismiss-sections-head">
                <span>保留哪些信息</span>
                <button type="button" className="ghost" disabled={busy} onClick={() => setSections(catalog.map((s) => s.id))}>全选</button>
                <button type="button" className="ghost" disabled={busy} onClick={() => setSections([])}>清空</button>
              </div>
              <div className="dismiss-sec-grid">
                {catalog.map((s) => (
                  <label key={s.id} className={`dismiss-sec ${sections.includes(s.id) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={sections.includes(s.id)}
                      disabled={busy}
                      onChange={() => toggleSec(s.id)}
                    />
                    <span className="dismiss-sec-label">{s.label}</span>
                    <span className="dismiss-sec-hint">{s.hint}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
        {err && <p className="tm-err">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => onClose?.()}>取消</button>
          <button type="button" className="danger" disabled={busy || (keep && sections.length === 0)} onClick={confirm}>
            {busy ? '处理中…' : '确认解聘'}
          </button>
        </div>
      </div>
    </div>
  )
}
