import { useCallback, useEffect, useState } from 'react'
import { hasBearerToken, shouldForceLogout } from './authRequest.js'

const API = '/api'

/** 十种常用数据库类型及本机客户端探测命令 */
const DB_TYPES = [
  { id: 'mysql', label: 'MySQL', client: 'mysql', needsDB: true },
  { id: 'mariadb', label: 'MariaDB', client: 'mariadb/mysql', needsDB: true },
  { id: 'pgsql', label: 'PostgreSQL', client: 'psql', needsDB: true },
  { id: 'redis', label: 'Redis', client: 'redis-cli', needsDB: false },
  { id: 'mongodb', label: 'MongoDB', client: 'mongosh', needsDB: true },
  { id: 'sqlite', label: 'SQLite', client: 'sqlite3', needsDB: true },
  { id: 'clickhouse', label: 'ClickHouse', client: 'clickhouse-client', needsDB: true },
  { id: 'elasticsearch', label: 'Elasticsearch', client: 'curl', needsDB: false },
  { id: 'oracle', label: 'Oracle', client: 'sqlplus', needsDB: true },
  { id: 'sqlserver', label: 'SQL Server', client: 'sqlcmd', needsDB: true },
]

const PERMS = [
  { key: 'perm_list', label: '列目录', hint: 'L' },
  { key: 'perm_read', label: '查询', hint: 'R' },
  { key: 'perm_create', label: '新增', hint: 'C' },
  { key: 'perm_update', label: '修改', hint: 'U' },
  { key: 'perm_delete', label: '删除', hint: 'D' },
]

function emptyDraft() {
  return {
    name: '',
    db_type: '',
    url: '',
    database_name: '',
    username: '',
    password: '',
    perm_list: true,
    perm_read: true,
    perm_create: false,
    perm_update: false,
    perm_delete: false,
  }
}

function resolveHeaders(authHeaders, extra = {}) {
  const base = typeof authHeaders === 'function' ? authHeaders() : (authHeaders || {})
  return { ...base, ...extra }
}

function typeMeta(id) {
  return DB_TYPES.find((t) => t.id === id) || { id, label: id, client: id, needsDB: true }
}

/** 数据库技能：多数据源配置 */
export default function DatabaseSourcesPanel({ agentId, authHeaders, onUnauthorized, disabled = false }) {
  const [sources, setSources] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // null | 'new' | source id
  const [draft, setDraft] = useState(() => emptyDraft())
  const [typeClient, setTypeClient] = useState(null) // { ok, bin, label } | null | 'loading'

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
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/db-sources`, { headers }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '加载数据源失败')
        return
      }
      setSources(data.sources || [])
      setErr('')
    } catch (e) {
      setErr(e.message || '加载失败')
    }
  }, [agentId, authHeaders, handleRes])

  useEffect(() => { load() }, [load])

  // 仅在选中类型后检测对应客户端
  useEffect(() => {
    if (editing == null || !draft.db_type) {
      setTypeClient(null)
      return
    }
    let cancelled = false
    setTypeClient('loading')
    ;(async () => {
      const headers = resolveHeaders(authHeaders)
      if (!hasBearerToken(headers)) return
      try {
        const res = handleRes(await fetch(`${API}/admin/db-clients?type=${encodeURIComponent(draft.db_type)}`, { headers }), headers)
        if (!res || cancelled) return
        const data = await res.json().catch(() => ({}))
        const st = data.clients?.[draft.db_type]
        if (!cancelled) setTypeClient(st || { ok: false, db_type: draft.db_type })
      } catch {
        if (!cancelled) setTypeClient({ ok: false, db_type: draft.db_type })
      }
    })()
    return () => { cancelled = true }
  }, [editing, draft.db_type, authHeaders, handleRes])

  function openNew() {
    setEditing('new')
    setDraft(emptyDraft())
    setTypeClient(null)
    setErr('')
  }

  function openEdit(src) {
    setEditing(src.id)
    setDraft({
      name: src.name || '',
      db_type: src.db_type || '',
      url: src.url || '',
      database_name: src.database_name || '',
      username: src.username || '',
      password: '',
      perm_list: !!src.perm_list,
      perm_read: !!src.perm_read,
      perm_create: !!src.perm_create,
      perm_update: !!src.perm_update,
      perm_delete: !!src.perm_delete,
    })
    setErr('')
  }

  function closeForm() {
    setEditing(null)
    setTypeClient(null)
  }

  async function save(e) {
    e?.preventDefault?.()
    if (!draft.db_type) {
      setErr('请先选择数据库类型')
      return
    }
    setBusy(true)
    try {
      const headers = resolveHeaders(authHeaders, { 'Content-Type': 'application/json' })
      const body = {
        name: draft.name.trim(),
        db_type: draft.db_type,
        url: draft.url.trim(),
        database_name: draft.database_name.trim(),
        username: draft.username.trim(),
        password: draft.password,
        perm_list: !!draft.perm_list,
        perm_read: !!draft.perm_read,
        perm_create: !!draft.perm_create,
        perm_update: !!draft.perm_update,
        perm_delete: !!draft.perm_delete,
      }
      const isNew = editing === 'new'
      const url = isNew
        ? `${API}/admin/agents/${agentId}/db-sources`
        : `${API}/admin/agents/${agentId}/db-sources/${editing}`
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
    if (!window.confirm('确定移除该数据源？')) return
    setBusy(true)
    try {
      const headers = resolveHeaders(authHeaders)
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/db-sources/${id}`, {
        method: 'DELETE',
        headers,
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

  const meta = typeMeta(draft.db_type)
  const showForm = editing != null

  return (
    <div className="dbs-panel">
      {err && <p className="sk-err">{err}</p>}

      {/* 列表页：仅展示已添加数据源 */}
      {!showForm && (
        <>
          <div className="dbs-head">
            <div>
              <h4>数据源</h4>
              <p className="dbs-hint">可添加多个库连接。密码会加密保存；绿点表示本机已安装对应命令行工具。</p>
            </div>
            <button type="button" className="ghost" disabled={busy || disabled} onClick={openNew}>添加数据源</button>
          </div>

          <div className="dbs-list">
            {sources.length === 0 ? (
              <p className="muted sk-empty">还没有数据源，点击右上角添加。</p>
            ) : (
              sources.map((src) => (
                <article key={src.id} className="dbs-card">
                  <div className="dbs-card-main">
                    <span className={`dbs-dot ${src.client_ok ? 'ok' : 'miss'}`} title={src.client_ok ? src.client_bin : '本机未找到客户端'} />
                    <div>
                      <div className="dbs-card-title">
                        <strong>{src.name}</strong>
                        <span className="dbs-type">{typeMeta(src.db_type).label}</span>
                        <span className="dbs-perms">{permLabel(src)}</span>
                      </div>
                      <p className="muted">
                        {src.url}
                        {src.database_name ? ` / ${src.database_name}` : ''}
                        {src.username ? ` · ${src.username}` : ''}
                        {src.password_set ? ' · 已设密码' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="dbs-card-actions">
                    <button type="button" className="ghost" disabled={busy || disabled} onClick={() => openEdit(src)}>编辑</button>
                    <button type="button" className="ghost danger" disabled={busy || disabled} onClick={() => remove(src.id)}>移除</button>
                  </div>
                </article>
              ))
            )}
          </div>
        </>
      )}

      {/* 添加/编辑页：不展示已有列表，避免页面被拉长 */}
      {showForm && (
        <form className="dbs-form" onSubmit={save}>
          <h4>{editing === 'new' ? '添加数据源' : '编辑数据源'}</h4>
          <p className="dbs-hint">先选数据库类型，再填写连接信息。选好类型后会自动检测本机是否已装客户端。</p>

          <label>
            数据库类型
            <select
              required
              value={draft.db_type}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, db_type: e.target.value })}
            >
              <option value="">请选择…</option>
              {DB_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          {draft.db_type && (
            <div className={`dbs-client-status ${typeClient === 'loading' ? '' : (typeClient?.ok ? 'ok' : 'miss')}`}>
              <span className={`dbs-dot ${typeClient === 'loading' ? '' : (typeClient?.ok ? 'ok' : 'miss')}`} />
              {typeClient === 'loading' && <span>正在检测本机 {meta.client}…</span>}
              {typeClient && typeClient !== 'loading' && typeClient.ok && (
                <span>已检测到客户端 <code>{typeClient.label || meta.client}</code></span>
              )}
              {typeClient && typeClient !== 'loading' && !typeClient.ok && (
                <span>本机未找到 {meta.client}，仍可保存配置（连接时可能需自行安装）</span>
              )}
            </div>
          )}

          <label>
            名称
            <input required value={draft.name} disabled={busy} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如：订单主库" />
          </label>
          <label>
            URL / 主机
            <input required value={draft.url} disabled={busy} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="127.0.0.1:3306 或主机地址" />
          </label>
          {draft.db_type && meta.needsDB && (
            <label>
              库名
              <input value={draft.database_name} disabled={busy} onChange={(e) => setDraft({ ...draft, database_name: e.target.value })} />
            </label>
          )}
          <div className="dbs-form-row">
            <label>
              用户名
              <input value={draft.username} disabled={busy} onChange={(e) => setDraft({ ...draft, username: e.target.value })} autoComplete="off" />
            </label>
            <label>
              密码{editing !== 'new' ? '（留空则不改）' : ''}
              <input type="password" value={draft.password} disabled={busy} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" />
            </label>
          </div>
          <fieldset className="dbs-perms-fieldset">
            <legend>权限（可多选）</legend>
            <div className="dbs-perms-grid">
              {PERMS.map((p) => (
                <label key={p.key} className="dbs-perm-check">
                  <input
                    type="checkbox"
                    checked={!!draft[p.key]}
                    disabled={busy}
                    onChange={(e) => setDraft({ ...draft, [p.key]: e.target.checked })}
                  />
                  <span>{p.label}</span>
                  <small>{p.hint}</small>
                </label>
              ))}
            </div>
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

function permLabel(src) {
  let s = ''
  if (src.perm_list) s += 'L'
  if (src.perm_read) s += 'R'
  if (src.perm_create) s += 'C'
  if (src.perm_update) s += 'U'
  if (src.perm_delete) s += 'D'
  return s || '-'
}
