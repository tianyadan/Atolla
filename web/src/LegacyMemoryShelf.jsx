import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentAvatarUrl } from './agentAvatar.js'

const API = '/api'

const STATUS_ZH = {
  generating: '生成中',
  ready: '可认领',
  failed: '待补全',
}

/**
 * 数字员工记忆书架：书本风卡片，仅解聘 AI 生成；可编辑、认领挂载。
 */
export default function LegacyMemoryShelf({ authHeaders, onUnauthorized, active }) {
  const [items, setItems] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimAgentId, setClaimAgentId] = useState(0)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [memRes, agRes] = await Promise.all([
        fetch(`${API}/admin/legacy-memories`, { headers: authHeaders() }),
        fetch(`${API}/admin/agents`, { headers: authHeaders() }),
      ])
      if (memRes.status === 401 || agRes.status === 401) { onUnauthorized?.(); return }
      const md = await memRes.json().catch(() => ({}))
      const ad = await agRes.json().catch(() => ({}))
      if (!memRes.ok) throw new Error(md.error || '加载记忆书架失败')
      setItems(md.items || [])
      setAgents(ad.items || [])
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onUnauthorized])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  // 生成中自动刷新
  useEffect(() => {
    if (!active) return undefined
    const hasGen = items.some((m) => m.status === 'generating')
    if (!hasGen) return undefined
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [active, items, load])

  const readyAgents = useMemo(
    () => agents.filter((a) => a.status !== 'initializing'),
    [agents],
  )

  async function openBook(id) {
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/legacy-memories/${id}`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '打开失败')
      setDetail(d)
      setEditBody(d.body_markdown || '')
      setEditTitle(d.job_title || '')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function saveBook() {
    if (!detail || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/legacy-memories/${detail.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ body_markdown: editBody, job_title: editTitle }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '保存失败')
      setDetail(d)
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function retryBook() {
    if (!detail || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/legacy-memories/${detail.id}/retry`, {
        method: 'POST', headers: authHeaders(),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || '重试失败')
      }
      setDetail(null)
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function claimBook() {
    if (!detail || !claimAgentId || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/legacy-memories/${detail.id}/claim`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ agent_id: Number(claimAgentId) }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '认领失败')
      setClaimOpen(false)
      setDetail(null)
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lm-shelf">
      <div className="lm-shelf-head">
        <div>
          <h2>数字员工记忆</h2>
          <p className="lm-shelf-sub">离职记忆如书陈列 · 仅解聘后由 AI 生成 · 认领后写入员工规则并下架</p>
        </div>
        <button type="button" className="ghost" disabled={loading || busy} onClick={load}>刷新</button>
      </div>
      {err && <p className="tm-err">{err}</p>}
      {loading && !items.length && <p className="empty">加载中…</p>}
      {!loading && items.length === 0 && (
        <div className="lm-empty">
          <div className="lm-empty-book" aria-hidden />
          <p>书架空空如也</p>
          <p className="muted">解聘数字员工并勾选「保留记忆」后，这里会出现一本可认领的记忆书</p>
        </div>
      )}
      <div className="lm-book-row">
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`lm-book st-${m.status}`}
            disabled={busy}
            onClick={() => openBook(m.id)}
          >
            <span className="lm-book-spine" />
            <span className="lm-book-cover">
              <img src={agentAvatarUrl({ avatar_url: m.avatar_url })} alt="" />
              <strong>{m.agent_name}</strong>
              <em>{m.job_title || '数字员工'}</em>
              <span className={`lm-book-badge st-${m.status}`}>{STATUS_ZH[m.status] || m.status}</span>
            </span>
          </button>
        ))}
      </div>

      {detail && (
        <div className="modal-mask" onClick={() => !busy && setDetail(null)}>
          <div className="modal-card lm-reader" onClick={(e) => e.stopPropagation()}>
            <div className="lm-reader-head">
              <img className="lm-reader-avatar" src={agentAvatarUrl({ avatar_url: detail.avatar_url })} alt="" />
              <div>
                <h2>{detail.agent_name}</h2>
                <p className="muted">{detail.job_title} · {STATUS_ZH[detail.status] || detail.status}</p>
              </div>
            </div>
            {(detail.status === 'ready' || detail.status === 'failed') && (
              <>
                <label>
                  岗位
                  <input value={editTitle} disabled={busy} onChange={(e) => setEditTitle(e.target.value)} />
                </label>
                <label>
                  记忆正文
                  <textarea rows={16} value={editBody} disabled={busy} onChange={(e) => setEditBody(e.target.value)} />
                </label>
              </>
            )}
            {detail.status === 'generating' && (
              <p className="muted">AI 正在整理离职记忆，请稍候…</p>
            )}
            {detail.error_message && (
              <p className="muted">备注：{detail.error_message}</p>
            )}
            <div className="modal-actions lm-reader-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setDetail(null)}>关闭</button>
              {(detail.status === 'failed' || detail.status === 'ready') && (
                <button type="button" className="ghost" disabled={busy} onClick={retryBook}>重新生成</button>
              )}
              {(detail.status === 'ready' || detail.status === 'failed') && (
                <button type="button" className="ghost" disabled={busy} onClick={saveBook}>保存编辑</button>
              )}
              {detail.status === 'ready' && (
                <button type="button" className="primary" disabled={busy} onClick={() => { setClaimOpen(true); setClaimAgentId(readyAgents[0]?.id || 0) }}>
                  认领挂载
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {claimOpen && detail && (
        <div className="modal-mask" onClick={() => !busy && setClaimOpen(false)}>
          <div className="modal-card ma-settings" onClick={(e) => e.stopPropagation()}>
            <h2>认领记忆</h2>
            <p className="muted">将「{detail.agent_name}」的记忆一次性写入所选员工规则区；每位最多 5 本，该书认领后下架。</p>
            <label>
              挂载到
              <select value={claimAgentId} disabled={busy} onChange={(e) => setClaimAgentId(Number(e.target.value))}>
                <option value={0}>请选择数字员工</option>
                {readyAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setClaimOpen(false)}>取消</button>
              <button type="button" className="primary" disabled={busy || !claimAgentId} onClick={claimBook}>
                {busy ? '挂载中…' : '确认认领'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
