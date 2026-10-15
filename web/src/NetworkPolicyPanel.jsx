import { useEffect, useState } from 'react'

const API = '/api'

/** 管理台「网络白名单」：编辑域名并同步到本机 Cursor / Claude / Codex 沙箱 */
export default function NetworkPolicyPanel({ authHeaders, onUnauthorized, active }) {
  const [patterns, setPatterns] = useState([])
  const [draft, setDraft] = useState('')
  const [syncInfo, setSyncInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    setErr('')
    try {
      const res = await fetch(`${API}/admin/network-allowlist`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `加载失败(${res.status})`)
      setPatterns((d.items || []).map((r) => r.pattern).filter(Boolean))
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function addDraft() {
    const p = draft.trim().toLowerCase()
    if (!p) return
    if (patterns.includes(p)) {
      setDraft('')
      return
    }
    setPatterns((prev) => [...prev, p])
    setDraft('')
  }

  function removeAt(i) {
    setPatterns((prev) => prev.filter((_, idx) => idx !== i))
  }

  /** 保存白名单并写入本机 CLI 配置 */
  async function saveAndSync() {
    if (busy) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API}/admin/network-allowlist`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ patterns }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `保存失败(${res.status})`)
      setPatterns((d.items || []).map((r) => r.pattern).filter(Boolean))
      setSyncInfo(d.sync || null)
      setMsg('已保存并同步到本机 CLI 配置')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  /** 仅重写本机文件（不改库） */
  async function syncOnly() {
    if (busy) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API}/admin/network-allowlist/sync`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `同步失败(${res.status})`)
      setSyncInfo(d.sync || null)
      setMsg('已同步到本机 CLI 配置')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="list rr-panel">
      <div className="lm-shelf-head">
        <div>
          <h2>网络白名单</h2>
          <p className="empty-hint">
            数字人开启「允许联网」后即可外联公开 API（如高德），不再按域名二次弹窗。
            本页域名列表用于同步本机 CLI；保存/同步会<strong>放宽</strong>沙箱出站（Cursor{' '}
            <code>networkPolicy.default=allow</code>，Claude 关闭 Bash 沙箱隔离，Codex 开启 network_access）。
            Cursor Desktop 仍需 Network access =「sandbox.json + Defaults」或 Allow All，否则 Agent 对话里的 Shell 仍可能被拦。
          </p>
        </div>
      </div>

      <article className="version-card">
        <div className="version-head">
          <span className="version-tag">域名列表</span>
        </div>
        <p className="empty-hint">支持精确域名或通配（如 <code>*.amap.com</code>）。建议保留常用 API 域，便于文档与后续收紧策略。</p>
        <ul className="rr-status-list" style={{ marginTop: 8 }}>
          {patterns.length === 0 && <li className="empty-hint">暂无条目（保存空列表会清空白名单）</li>}
          {patterns.map((p, i) => (
            <li key={`${p}-${i}`}>
              <code>{p}</code>
              <button type="button" className="ghost" disabled={busy} onClick={() => removeAt(i)} style={{ marginLeft: 8 }}>
                删除
              </button>
            </li>
          ))}
        </ul>
        <div className="tm-form-row" style={{ maxWidth: 520, marginTop: 12 }}>
          <label>
            <span>添加域名</span>
            <input
              type="text"
              value={draft}
              disabled={busy}
              placeholder="restapi.amap.com 或 *.example.com"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addDraft()
                }
              }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button type="button" className="ghost" disabled={busy || !draft.trim()} onClick={addDraft}>
            加入列表
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void saveAndSync()}>
            {busy ? '处理中…' : '保存并同步'}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => void syncOnly()}>
            仅同步到本机
          </button>
        </div>
        {msg && <p className="empty-hint" style={{ marginTop: 10, color: '#16a34a' }}>{msg}</p>}
        {err && <pre className="error" style={{ marginTop: 10 }}>{err}</pre>}
      </article>

      {syncInfo && (
        <article className="version-card">
          <div className="version-head">
            <span className="version-tag">最近同步</span>
          </div>
          <ul className="rr-status-list">
            <li>
              <span className="rr-status-label">条目数</span>
              <span>{syncInfo.patterns ?? '—'}</span>
            </li>
            <li>
              <span className="rr-status-label">Cursor</span>
              <span>{syncInfo.cursor_path || '—'}</span>
            </li>
            <li>
              <span className="rr-status-label">Claude</span>
              <span>{syncInfo.claude_path || '—'}</span>
            </li>
            <li>
              <span className="rr-status-label">Codex</span>
              <span>{syncInfo.codex_path || '—'}</span>
            </li>
            {(syncInfo.errors || []).length > 0 && (
              <li>
                <span className="rr-status-label">错误</span>
                <span className="rr-err-text">{(syncInfo.errors || []).join('; ')}</span>
              </li>
            )}
          </ul>
        </article>
      )}
    </section>
  )
}
