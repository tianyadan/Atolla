import { useCallback, useEffect, useMemo, useState } from 'react'
import { hasBearerToken, shouldForceLogout } from './authRequest.js'
import DatabaseSourcesPanel from './DatabaseSourcesPanel.jsx'
import ServerSourcesPanel from './ServerSourcesPanel.jsx'

const API = '/api'

const ICON_GLYPH = {
  search: '◎',
  browser: '◉',
  database: '▦',
  server: '▣',
  custom: '◇',
}

const RISK_ZH = { low: '低风险', mid: '中风险', high: '高风险' }
const CAT_ZH = { engine: '引擎', data: '数据', ops: '运维', custom: '自定义', general: '通用' }

const BUILTIN_ICON_URL = {
  database: '/skill-icons/database.svg',
  server: '/skill-icons/server.svg',
  browser: '/skill-icons/browser.svg',
}

/** 技能图标：内置 SVG / 自定义 URL / 字形兜底 */
function SkillIcon({ iconKey, iconUrl, size = 40 }) {
  const src = iconUrl || BUILTIN_ICON_URL[iconKey]
  if (src) {
    return <img className="sk-icon-img" src={src} alt="" style={{ width: size, height: size }} />
  }
  const glyph = ICON_GLYPH[iconKey] || ICON_GLYPH.custom
  return (
    <span className={`sk-icon sk-icon-${iconKey || 'custom'}`} style={{ width: size, height: size, fontSize: size * 0.32 }}>
      {glyph}
    </span>
  )
}

/** 解析 authHeaders：App 传入的是函数 authHeaders()，不是对象 */
function resolveHeaders(authHeaders, extra = {}) {
  const base = typeof authHeaders === 'function' ? authHeaders() : (authHeaders || {})
  return { ...base, ...extra }
}

/** 数字人设置内：已安装 + 技能商店 */
export default function AgentSkillsPanel({
  agentId,
  authHeaders,
  onUnauthorized,
  activeTab = 'installed',
  onTabChange,
  disabled = false,
}) {
  const [skills, setSkills] = useState([])
  const [store, setStore] = useState([])
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [dbConfigOpen, setDbConfigOpen] = useState(false)
  const [serverConfigOpen, setServerConfigOpen] = useState(false)
  const [browserUse, setBrowserUse] = useState(null) // { ok, version, message }
  const [installHint, setInstallHint] = useState('')
  const [pub, setPub] = useState({
    name: '', summary: '', description: '', icon_key: 'custom', risk: 'mid',
    rules_text: 'allow: 按描述执行\ndeny: 不得越权',
  })

  const handleRes = useCallback((res, headers) => {
    if (onUnauthorized && shouldForceLogout(res?.status, headers)) {
      onUnauthorized()
      return null
    }
    return res
  }, [onUnauthorized])

  const loadAgentSkills = useCallback(async () => {
    if (!agentId) return
    const headers = resolveHeaders(authHeaders)
    if (!hasBearerToken(headers)) return
    try {
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/skills`, { headers }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '加载技能失败')
        return
      }
      setSkills(data.skills || [])
      setErr('')
    } catch (e) {
      setErr(e.message || '加载技能失败')
    }
  }, [agentId, authHeaders, handleRes])

  const loadStore = useCallback(async () => {
    const headers = resolveHeaders(authHeaders)
    if (!hasBearerToken(headers)) return
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (category) params.set('category', category)
    try {
      const res = handleRes(await fetch(`${API}/admin/skills/store?${params}`, { headers }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '加载商店失败')
        return
      }
      setStore(data.skills || [])
      setErr('')
    } catch (e) {
      setErr(e.message || '加载商店失败')
    }
  }, [authHeaders, category, handleRes, q])

  useEffect(() => {
    loadAgentSkills()
  }, [loadAgentSkills])

  const loadBrowserUse = useCallback(async () => {
    const headers = resolveHeaders(authHeaders)
    if (!hasBearerToken(headers)) return
    try {
      const res = handleRes(await fetch(`${API}/admin/browser-use`, { headers }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (res.ok) setBrowserUse(data)
    } catch { /* ignore */ }
  }, [authHeaders, handleRes])

  useEffect(() => {
    if (activeTab === 'store') loadStore()
  }, [activeTab, loadStore])

  useEffect(() => {
    loadBrowserUse()
  }, [loadBrowserUse])

  const installedMap = useMemo(() => {
    const m = {}
    for (const s of skills) {
      if (s.installed) m[s.id] = s
    }
    return m
  }, [skills])

  const installedList = useMemo(() => skills.filter((s) => s.installed), [skills])

  async function install(skillId, capabilities) {
    setBusy(true)
    setErr('')
    setInstallHint('')
    try {
      if (skillId === 'atolla.browser') {
        setInstallHint(browserUse?.ok ? 'browser-use 已就绪，正在安装技能…' : '正在检测并安装 browser-use（可能需要一两分钟）…')
      }
      const headers = resolveHeaders(authHeaders, { 'Content-Type': 'application/json' })
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/skills/install`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ skill_id: skillId, capabilities }),
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '安装失败')
        return
      }
      setSkills(data.skills || [])
      setDetail(null)
      if (skillId === 'atolla.browser') await loadBrowserUse()
    } finally {
      setBusy(false)
      setInstallHint('')
    }
  }

  async function uninstall(skillId) {
    setBusy(true)
    try {
      const headers = resolveHeaders(authHeaders)
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/skills/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
        headers,
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '卸载失败')
        return
      }
      setSkills(data.skills || [])
      setDetail(null)
    } finally {
      setBusy(false)
    }
  }

  async function patchSkill(skillId, body) {
    setBusy(true)
    try {
      const headers = resolveHeaders(authHeaders, { 'Content-Type': 'application/json' })
      const res = handleRes(await fetch(`${API}/admin/agents/${agentId}/skills/${encodeURIComponent(skillId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '更新失败')
        return
      }
      setSkills(data.skills || [])
    } finally {
      setBusy(false)
    }
  }

  async function publishCustom(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const rules = String(pub.rules_text || '').split('\n').map((line) => {
        const m = line.match(/^(allow|deny|note)\s*[:：]\s*(.+)$/i)
        if (m) return { type: m[1].toLowerCase(), text: m[2].trim() }
        const t = line.trim()
        return t ? { type: 'note', text: t } : null
      }).filter(Boolean)
      const headers = resolveHeaders(authHeaders, { 'Content-Type': 'application/json' })
      const res = handleRes(await fetch(`${API}/admin/skills/custom`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: pub.name,
          summary: pub.summary,
          description: pub.description || pub.summary,
          icon_key: pub.icon_key,
          risk: pub.risk,
          category: 'custom',
          rules,
          capabilities: [{ id: 'prompt.only', label: '提示约束', default_on: true }],
        }),
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || '发布失败')
        return
      }
      setPublishOpen(false)
      setPub({ name: '', summary: '', description: '', icon_key: 'custom', risk: 'mid', rules_text: 'allow: 按描述执行\ndeny: 不得越权' })
      await loadStore()
    } finally {
      setBusy(false)
    }
  }

  function openDetail(skill) {
    setDetail(skill)
  }

  return (
    <div className="sk-panel">
      <div className="sk-tabs" role="tablist">
        <button type="button" className={activeTab === 'installed' ? 'active' : ''} disabled={disabled} onClick={() => onTabChange?.('installed')}>
          已安装技能
          {installedList.length > 0 && <span className="sk-tab-count">{installedList.length}</span>}
        </button>
        <button type="button" className={activeTab === 'store' ? 'active' : ''} disabled={disabled} onClick={() => onTabChange?.('store')}>
          技能商店
        </button>
      </div>

      {err && <p className="sk-err">{err}</p>}
      {installHint && <p className="dbs-hint">{installHint}</p>}

      {activeTab === 'installed' && (
        <div className="sk-list">
          {installedList.length === 0 ? (
            <p className="muted sk-empty">尚未安装技能。去「技能商店」浏览并安装到此数字人。</p>
          ) : (
            installedList.map((sk) => (
              <article key={sk.id} className={`sk-card ${sk.enabled ? '' : 'sk-card-off'}`}>
                <button type="button" className="sk-card-main" onClick={() => openDetail(sk)}>
                  <SkillIcon iconKey={sk.icon_key} iconUrl={sk.icon_url} />
                  <div className="sk-card-body">
                    <div className="sk-card-title-row">
                      <strong>{sk.name}</strong>
                      <span className={`sk-risk sk-risk-${sk.risk || 'mid'}`}>{RISK_ZH[sk.risk] || sk.risk}</span>
                      {sk.id === 'atolla.browser' && (
                        <span className={`dbs-dot ${browserUse?.ok ? 'ok' : 'miss'}`} title={browserUse?.ok ? (browserUse.version || 'browser-use 已安装') : 'browser-use 未就绪'} />
                      )}
                    </div>
                    <p>{sk.summary}</p>
                    {!sk.enabled && <span className="sk-badge-off">已停用</span>}
                  </div>
                </button>
                <div className="sk-card-actions">
                  {sk.id === 'atolla.database' && (
                    <button type="button" className="ghost" disabled={busy || disabled} onClick={() => setDbConfigOpen(true)}>配置数据源</button>
                  )}
                  {sk.id === 'atolla.server_control' && (
                    <button type="button" className="ghost" disabled={busy || disabled} onClick={() => setServerConfigOpen(true)}>配置服务器</button>
                  )}
                  <button type="button" className="ghost" disabled={busy || disabled} onClick={() => patchSkill(sk.id, { enabled: !sk.enabled })}>
                    {sk.enabled ? '停用' : '启用'}
                  </button>
                  <button type="button" className="ghost danger" disabled={busy || disabled} onClick={() => uninstall(sk.id)}>卸载</button>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {dbConfigOpen && (
        <div className="modal-mask sk-detail-mask" onClick={() => setDbConfigOpen(false)}>
          <div className="modal-card sk-detail dbs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dbs-modal-head">
              <h3>数据库访问 · 数据源</h3>
              <button type="button" className="ghost" onClick={() => setDbConfigOpen(false)}>关闭</button>
            </div>
            <DatabaseSourcesPanel
              agentId={agentId}
              authHeaders={authHeaders}
              onUnauthorized={onUnauthorized}
              disabled={disabled || busy}
            />
          </div>
        </div>
      )}

      {serverConfigOpen && (
        <div className="modal-mask sk-detail-mask" onClick={() => setServerConfigOpen(false)}>
          <div className="modal-card sk-detail dbs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dbs-modal-head">
              <h3>服务器控制 · 服务器</h3>
              <button type="button" className="ghost" onClick={() => setServerConfigOpen(false)}>关闭</button>
            </div>
            <ServerSourcesPanel
              agentId={agentId}
              authHeaders={authHeaders}
              onUnauthorized={onUnauthorized}
              disabled={disabled || busy}
            />
          </div>
        </div>
      )}

      {activeTab === 'store' && (
        <div className="sk-store">
          <div className="sk-store-bar">
            <input
              placeholder="搜索技能…"
              value={q}
              disabled={disabled}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadStore() } }}
            />
            <select value={category} disabled={disabled} onChange={(e) => setCategory(e.target.value)}>
              <option value="">全部分类</option>
              <option value="engine">引擎</option>
              <option value="data">数据</option>
              <option value="ops">运维</option>
              <option value="custom">自定义</option>
            </select>
            <button type="button" className="ghost" disabled={busy || disabled} onClick={loadStore}>搜索</button>
            <button type="button" className="ghost" disabled={busy || disabled} onClick={() => setPublishOpen(true)}>发布自定义</button>
          </div>
          <div className="sk-grid">
            {store.map((sk) => {
              const inst = installedMap[sk.id]
              return (
                <article key={sk.id} className="sk-store-card">
                  <button type="button" className="sk-card-main" onClick={() => openDetail({ ...sk, installed: !!inst, enabled: inst?.enabled, capabilities: inst?.capabilities || [] })}>
                    <SkillIcon iconKey={sk.icon_key} iconUrl={sk.icon_url} size={48} />
                    <div className="sk-card-body">
                      <div className="sk-card-title-row">
                        <strong>{sk.name}</strong>
                        <span className={`sk-risk sk-risk-${sk.risk || 'mid'}`}>{RISK_ZH[sk.risk] || '中风险'}</span>
                        {sk.id === 'atolla.browser' && (
                          <span className={`dbs-dot ${browserUse?.ok ? 'ok' : 'miss'}`} title={browserUse?.ok ? 'browser-use 已安装' : '安装技能时将自动下载 browser-use'} />
                        )}
                      </div>
                      <p>{sk.summary}</p>
                      <div className="sk-meta">
                        <span>{CAT_ZH[sk.category] || sk.category}</span>
                        <span>{sk.author || 'Atolla'}</span>
                        <span>v{sk.version}</span>
                      </div>
                    </div>
                  </button>
                  <div className="sk-card-actions">
                    {inst ? (
                      <button type="button" className="ghost" disabled={busy || disabled} onClick={() => uninstall(sk.id)}>已安装 · 卸载</button>
                    ) : (
                      <button type="button" disabled={busy || disabled} onClick={() => install(sk.id, defaultCaps(sk.capabilities))}>
                        安装到此数字人
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-mask sk-detail-mask" onClick={() => setDetail(null)}>
          <div className="modal-card sk-detail" onClick={(e) => e.stopPropagation()}>
            <div className="sk-detail-head">
              <SkillIcon iconKey={detail.icon_key} iconUrl={detail.icon_url} size={56} />
              <div>
                <h3>{detail.name}</h3>
                <p className="muted">{detail.summary}</p>
                <div className="sk-meta">
                  <span className={`sk-risk sk-risk-${detail.risk || 'mid'}`}>{RISK_ZH[detail.risk] || '中风险'}</span>
                  <span>{detail.author || 'Atolla'}</span>
                  <span>v{detail.version}</span>
                </div>
              </div>
            </div>
            <h4>功能规则</h4>
            <ul className="sk-rules">
              {(detail.rules || []).map((r, i) => (
                <li key={i} className={`sk-rule sk-rule-${r.type}`}>
                  <span>{ruleLabel(r.type)}</span>
                  {r.text}
                </li>
              ))}
            </ul>
            {!!(detail.all_capabilities || detail.capabilities)?.length && (
              <>
                <h4>能力</h4>
                <div className="sk-caps">
                  {(detail.all_capabilities || []).length > 0
                    ? detail.all_capabilities.map((c) => (
                      <span key={c.id} className="sk-cap">{c.label || c.id}</span>
                    ))
                    : (Array.isArray(detail.capabilities) ? detail.capabilities : []).map((id) => (
                      <span key={id} className="sk-cap">{typeof id === 'string' ? id : id.id}</span>
                    ))}
                </div>
              </>
            )}
            <p className="sk-desc">{detail.description}</p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setDetail(null)}>关闭</button>
              {detail.installed ? (
                <button type="button" className="ghost danger" disabled={busy || disabled} onClick={() => uninstall(detail.id)}>卸载</button>
              ) : (
                <button type="button" disabled={busy || disabled} onClick={() => install(detail.id, defaultCaps(detail.capabilities || detail.all_capabilities))}>
                  安装到此数字人
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {publishOpen && (
        <div className="modal-mask sk-detail-mask" onClick={() => !busy && setPublishOpen(false)}>
          <form className="modal-card sk-publish" onClick={(e) => e.stopPropagation()} onSubmit={publishCustom}>
            <h3>发布自定义技能</h3>
            <p className="muted">声明式技能：写入商店后可安装到任意数字人，规则会注入系统提示。</p>
            <label>
              名称
              <input required value={pub.name} disabled={busy} onChange={(e) => setPub({ ...pub, name: e.target.value })} />
            </label>
            <label>
              简介
              <input required value={pub.summary} disabled={busy} onChange={(e) => setPub({ ...pub, summary: e.target.value })} />
            </label>
            <label>
              详细说明
              <textarea rows={3} value={pub.description} disabled={busy} onChange={(e) => setPub({ ...pub, description: e.target.value })} />
            </label>
            <label>
              规则（每行：allow:/deny:/note:）
              <textarea rows={4} value={pub.rules_text} disabled={busy} onChange={(e) => setPub({ ...pub, rules_text: e.target.value })} />
            </label>
            <div className="sk-publish-row">
              <label>
                图标
                <select value={pub.icon_key} disabled={busy} onChange={(e) => setPub({ ...pub, icon_key: e.target.value })}>
                  {Object.keys(ICON_GLYPH).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label>
                风险
                <select value={pub.risk} disabled={busy} onChange={(e) => setPub({ ...pub, risk: e.target.value })}>
                  <option value="low">低</option>
                  <option value="mid">中</option>
                  <option value="high">高</option>
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setPublishOpen(false)}>取消</button>
              <button type="submit" disabled={busy}>{busy ? '发布中…' : '发布到本机商店'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function defaultCaps(caps) {
  if (!Array.isArray(caps) || caps.length === 0) return undefined
  if (typeof caps[0] === 'string') return caps
  return caps.filter((c) => c.default_on !== false).map((c) => c.id)
}

function ruleLabel(type) {
  if (type === 'allow') return '允许'
  if (type === 'deny') return '禁止'
  return '说明'
}
