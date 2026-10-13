import { useCallback, useEffect, useState } from 'react'
import { hasBearerToken, shouldForceLogout } from './authRequest.js'

const API = '/api'

function emptyDraft() {
  return {
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    allow_delete: false,
    allow_docker_restart: false,
  }
}

function resolveHeaders(authHeaders, extra = {}) {
  const base = typeof authHeaders === 'function' ? authHeaders() : (authHeaders || {})
  return { ...base, ...extra }
}

/** 服务器控制技能：多台 SSH 服务器配置 */
export default function ServerSourcesPanel({ agentId, authHeaders, onUnauthorized, disabled = false }) {
  const [sources, setSources] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [testingId, setTestingId] = useState(0)
  const [editing, setEditing] = useState(null) // null | 'new' | id
  const [draft, setDraft] = useState(() => emptyDraft())

  const handleRes = useCallback((res, headers) => {
    if (onUnauthorized && shouldForceLogout(res?.status, headers)) {
      onUnauthorized()
      return null
    }
    return res
  }, [onUnauthorized])

  const load = useCallback(async () => {
    if (!agentId) return
    const headers = resolveHeaders(authHeaders)
    if (!hasBearerToken(headers)) return
    try {
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/server-sources`, { headers }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '加载服务器失败')
        return
      }
      setSources(data.sources || [])
      setErr('')
    } catch (e) {
      setErr(e.message || '加载失败')
    }
  }, [agentId, authHeaders, handleRes])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing('new')
    setDraft(emptyDraft())
    setErr('')
  }

  function openEdit(src) {
    setEditing(src.id)
    setDraft({
      name: src.name || '',
      host: src.host || '',
      port: src.port || 22,
      username: src.username || '',
      password: '',
      allow_delete: !!src.allow_delete,
      allow_docker_restart: !!src.allow_docker_restart,
    })
    setErr('')
  }

  function closeForm() {
    setEditing(null)
  }

  async function save(e) {
    e?.preventDefault?.()
    setBusy(true)
    try {
      const headers = resolveHeaders(authHeaders, { 'Content-Type': 'application/json' })
      const body = {
        name: draft.name.trim(),
        host: draft.host.trim(),
        port: Number(draft.port) || 22,
        username: draft.username.trim(),
        password: draft.password,
        allow_delete: !!draft.allow_delete,
        allow_docker_restart: !!draft.allow_docker_restart,
      }
      const isNew = editing === 'new'
      const url = isNew
        ? `${API}/admin/agents/${agentId}/server-sources`
        : `${API}/admin/agents/${agentId}/server-sources/${editing}`
      const res = handleRes(await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers,
        body: JSON.stringify(body),
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '保存失败')
        return
      }
      closeForm()
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('确定移除该服务器？')) return
    setBusy(true)
    try {
      const headers = resolveHeaders(authHeaders)
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/server-sources/${id}`, {
        method: 'DELETE', headers,
      }), headers)
      if (!res) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data.error || '删除失败')
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function testConn(id) {
    setTestingId(id)
    setErr('')
    try {
      const headers = resolveHeaders(authHeaders)
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/server-sources/${id}/test`, {
        method: 'POST', headers,
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '测试失败')
        return
      }
      setSources((prev) => prev.map((s) => (s.id === id ? data : s)))
      if (!data.reachable) {
        setErr(data.last_test_error || '无法连接')
      }
    } finally {
      setTestingId(0)
    }
  }

  const showForm = editing != null

  return (
    <div className="dbs-panel">
      {err && <p className="sk-err">{err}</p>}

      {!showForm && (
        <>
          <div className="dbs-head">
            <div>
              <h4>服务器</h4>
              <p className="dbs-hint">可添加多台 SSH 服务器。密码加密保存；绿点表示最近一次测连成功。删除/重启容器默认禁止，勾选后仍会每次询问你。</p>
            </div>
            <button type="button" className="ghost" disabled={busy || disabled} onClick={openNew}>添加服务器</button>
          </div>

          <div className="dbs-list">
            {sources.length === 0 ? (
              <p className="muted sk-empty">还没有服务器，点击右上角添加。</p>
            ) : (
              sources.map((src) => (
                <article key={src.id} className="dbs-card">
                  <div className="dbs-card-main">
                    <span className={`dbs-dot ${src.reachable ? 'ok' : 'miss'}`} title={src.reachable ? '可连接' : (src.last_test_error || '未测通')} />
                    <div>
                      <div className="dbs-card-title">
                        <strong>{src.name}</strong>
                        <span className="dbs-type">SSH</span>
                        {src.allow_delete && <span className="dbs-perms">删·询</span>}
                        {src.allow_docker_restart && <span className="dbs-perms">重启容器·询</span>}
                      </div>
                      <p className="muted">
                        {src.username}@{src.host}:{src.port || 22}
                        {src.password_set ? ' · 已设密码' : ' · 未设密码'}
                        {src.last_test_error ? ` · ${src.last_test_error}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="dbs-card-actions">
                    <button type="button" className="ghost" disabled={busy || disabled || testingId === src.id} onClick={() => testConn(src.id)}>
                      {testingId === src.id ? '测试中…' : '测试连接'}
                    </button>
                    <button type="button" className="ghost" disabled={busy || disabled} onClick={() => openEdit(src)}>编辑</button>
                    <button type="button" className="ghost danger" disabled={busy || disabled} onClick={() => remove(src.id)}>移除</button>
                  </div>
                </article>
              ))
            )}
          </div>
        </>
      )}

      {showForm && (
        <form className="dbs-form" onSubmit={save}>
          <h4>{editing === 'new' ? '添加服务器' : '编辑服务器'}</h4>
          <p className="dbs-hint">填写 SSH 地址与账号。保存后会自动尝试登录；也可稍后在列表里点「测试连接」。</p>

          <label>
            名称
            <input required value={draft.name} disabled={busy} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如：生产机-1" />
          </label>
          <div className="dbs-form-row">
            <label>
              主机地址
              <input required value={draft.host} disabled={busy} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="IP 或域名" />
            </label>
            <label>
              端口
              <input type="number" min={1} max={65535} value={draft.port} disabled={busy} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || 22 })} />
            </label>
          </div>
          <div className="dbs-form-row">
            <label>
              账号
              <input required value={draft.username} disabled={busy} onChange={(e) => setDraft({ ...draft, username: e.target.value })} autoComplete="off" />
            </label>
            <label>
              密码{editing !== 'new' ? '（留空则不改）' : ''}
              <input type="password" value={draft.password} disabled={busy} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" required={editing === 'new'} />
            </label>
          </div>

          <fieldset className="dbs-perms-fieldset">
            <legend>危险权限（勾选后仍每次询问）</legend>
            <div className="dbs-perms-grid">
              <label className="dbs-perm-check">
                <input type="checkbox" checked={!!draft.allow_delete} disabled={busy} onChange={(e) => setDraft({ ...draft, allow_delete: e.target.checked })} />
                <span>允许删除/停止</span>
                <small>问</small>
              </label>
              <label className="dbs-perm-check">
                <input type="checkbox" checked={!!draft.allow_docker_restart} disabled={busy} onChange={(e) => setDraft({ ...draft, allow_docker_restart: e.target.checked })} />
                <span>允许重启 Docker 容器</span>
                <small>问</small>
              </label>
            </div>
            <p className="dbs-hint" style={{ marginTop: 8 }}>关机、整机重启等操作始终禁止，无法勾选放开。</p>
          </fieldset>

          <div className="modal-actions">
            <button type="button" className="ghost" disabled={busy} onClick={closeForm}>取消</button>
            <button type="submit" disabled={busy || disabled}>{busy ? '保存中…' : '保存'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
