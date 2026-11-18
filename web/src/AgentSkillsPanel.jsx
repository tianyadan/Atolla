import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale } from './i18n/useLocale.js'
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

const CAT_KEYS = ['engine', 'data', 'ops', 'custom', 'general']

const BUILTIN_ICON_URL = {
  database: '/skill-icons/database.svg',
  server: '/skill-icons/server.svg',
  browser: '/skill-icons/browser.svg',
  search: '/skill-icons/search.svg',
}

/** Built-in skill card tags (locale via t keys) */
const SKILL_TAG_KEYS = {
  'atolla.database': ['agentSettings.tag.data', 'SQL', 'MySQL', 'PostgreSQL'],
  'atolla.browser': ['agentSettings.tag.browser', 'agentSettings.tag.automation', 'agentSettings.tag.webOps'],
  'atolla.search': ['agentSettings.tag.search', 'RAG', 'agentSettings.tag.docs'],
  'atolla.server_control': ['SSH', 'agentSettings.cat.ops', 'agentSettings.tag.deploy', 'agentSettings.tag.files'],
}

/** Resolve a tag token: i18n key or literal */
function resolveTag(token, t) {
  if (typeof token === 'string' && token.startsWith('agentSettings.')) return t(token)
  return token
}

/** Build up to 4 display tags for a skill card */
function skillTags(sk, t) {
  if (SKILL_TAG_KEYS[sk?.id]) return SKILL_TAG_KEYS[sk.id].map((tok) => resolveTag(tok, t))
  const tags = []
  if (sk?.category && CAT_KEYS.includes(sk.category)) {
    tags.push(t(`agentSettings.cat.${sk.category}`))
  }
  for (const c of sk?.capabilities || []) {
    const label = typeof c === 'string' ? c : (c?.label || c?.id)
    if (label && !tags.includes(label) && tags.length < 4) tags.push(label)
  }
  return tags.slice(0, 4)
}

function IconSearch({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconStack({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l9 4.5-9 4.5L3 7.5 12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 12l9 4.5 9-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 16.5L12 21l9-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function IconDownload({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.5 11.5L12 16l4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
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
  const { t } = useLocale()
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
    rules_text: t('agentSettings.defaultRules'),
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
        setErr(data.error || t('agentSettings.err.loadSkills'))
        return
      }
      setSkills(data.skills || [])
      setErr('')
    } catch (e) {
      setErr(e.message || t('agentSettings.err.loadSkills'))
    }
  }, [agentId, authHeaders, handleRes, t])

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
        setErr(data.error || t('agentSettings.err.loadStore'))
        return
      }
      setStore(data.skills || [])
      setErr('')
    } catch (e) {
      setErr(e.message || t('agentSettings.err.loadStore'))
    }
  }, [authHeaders, category, handleRes, q, t])

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
        setInstallHint(browserUse?.ok ? t('agentSettings.hint.browserReady') : t('agentSettings.hint.browserInstalling'))
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
        setErr(data.error || t('agentSettings.err.install'))
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
        setErr(data.error || t('agentSettings.err.uninstall'))
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
        setErr(data.error || t('agentSettings.err.update'))
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
          capabilities: [{ id: 'prompt.only', label: t('agentSettings.cap.promptOnly'), default_on: true }],
        }),
      }), headers)
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || t('agentSettings.err.publish'))
        return
      }
      setPublishOpen(false)
      setPub({ name: '', summary: '', description: '', icon_key: 'custom', risk: 'mid', rules_text: t('agentSettings.defaultRules') })
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
          {t('agentSettings.skillsInstalled', { n: installedList.length })}
        </button>
        <button type="button" className={activeTab === 'store' ? 'active' : ''} disabled={disabled} onClick={() => onTabChange?.('store')}>
          {t('agentSettings.skillsStore')}
        </button>
      </div>

      {err && <p className="sk-err">{err}</p>}
      {installHint && <p className="dbs-hint">{installHint}</p>}

      {activeTab === 'installed' && (
        <div className="sk-list">
          {installedList.length === 0 ? (
            <p className="muted sk-empty">{t('agentSettings.skillsEmpty')}</p>
          ) : (
            installedList.map((sk) => (
              <article key={sk.id} className={`sk-card sk-store-card ${sk.enabled ? '' : 'sk-card-off'}`}>
                <button type="button" className="sk-store-card-hit" onClick={() => openDetail(sk)}>
                  <div className="sk-store-card-top">
                    <SkillIcon iconKey={sk.icon_key} iconUrl={sk.icon_url} size={44} />
                    <div className="sk-store-card-badges">
                      <span className={`sk-risk sk-risk-${sk.risk || 'mid'}`}>{t(`agentSettings.risk.${sk.risk || 'mid'}`)}</span>
                      {sk.id === 'atolla.browser' && (
                        <span className={`dbs-dot ${browserUse?.ok ? 'ok' : 'miss'}`} title={browserUse?.ok ? (browserUse.version || t('agentSettings.hint.browserOk')) : t('agentSettings.hint.browserMiss')} />
                      )}
                    </div>
                  </div>
                  <h4 className="sk-store-card-title">{sk.name}</h4>
                  <p className="sk-store-card-desc">{sk.summary}</p>
                  {!sk.enabled && <span className="sk-badge-off">{t('agentSettings.disabled')}</span>}
                  <div className="sk-tags">
                    {skillTags(sk, t).map((tag) => <span key={tag} className="sk-tag">{tag}</span>)}
                  </div>
                </button>
                <div className="sk-store-card-foot">
                  <span className="sk-author">{sk.author || 'Atolla'} <em>v{sk.version || '1.0.0'}</em></span>
                  <div className="sk-card-actions">
                    {sk.id === 'atolla.database' && (
                      <button type="button" className="ghost" disabled={busy || disabled} onClick={() => setDbConfigOpen(true)}>{t('agentSettings.configDb')}</button>
                    )}
                    {sk.id === 'atolla.server_control' && (
                      <button type="button" className="ghost" disabled={busy || disabled} onClick={() => setServerConfigOpen(true)}>{t('agentSettings.configServer')}</button>
                    )}
                    <button type="button" className="ghost" disabled={busy || disabled} onClick={() => patchSkill(sk.id, { enabled: !sk.enabled })}>
                      {sk.enabled ? t('agentSettings.disable') : t('agentSettings.enable')}
                    </button>
                    <button type="button" className="ghost danger" disabled={busy || disabled} onClick={() => uninstall(sk.id)}>{t('agentSettings.uninstall')}</button>
                  </div>
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
              <h3>{t('agentSettings.dbSourcesTitle')}</h3>
              <button type="button" className="ghost" onClick={() => setDbConfigOpen(false)}>{t('agentSettings.close')}</button>
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
              <h3>{t('agentSettings.serverSourcesTitle')}</h3>
              <button type="button" className="ghost" onClick={() => setServerConfigOpen(false)}>{t('agentSettings.close')}</button>
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
          <div className="sk-store-toolbar">
            <label className="sk-search-wrap">
              <button
                type="button"
                className="sk-search-ico"
                disabled={busy || disabled}
                aria-label={t('agentSettings.skillsSearchPh')}
                onClick={loadStore}
              >
                <IconSearch size={14} />
              </button>
              <input
                placeholder={t('agentSettings.skillsSearchPh')}
                value={q}
                disabled={disabled}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadStore() } }}
              />
            </label>
            <label className="sk-cat-select">
              <span className="sk-cat-ico"><IconStack size={13} /></span>
              <select value={category} disabled={disabled} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('agentSettings.skillsAllCats')}</option>
                <option value="engine">{t('agentSettings.cat.engine')}</option>
                <option value="data">{t('agentSettings.cat.data')}</option>
                <option value="ops">{t('agentSettings.cat.ops')}</option>
                <option value="custom">{t('agentSettings.cat.custom')}</option>
              </select>
            </label>
            <button type="button" className="sk-btn-publish" disabled={busy || disabled} onClick={() => setPublishOpen(true)}>
              {t('agentSettings.skillsPublish')}
            </button>
          </div>
          <div className="sk-grid">
            {store.length === 0 ? (
              <p className="muted sk-empty">{t('agentSettings.skillsNoMatch')}</p>
            ) : store.map((sk) => {
              const inst = installedMap[sk.id]
              return (
                <article key={sk.id} className="sk-store-card">
                  <button
                    type="button"
                    className="sk-store-card-hit"
                    onClick={() => openDetail({ ...sk, installed: !!inst, enabled: inst?.enabled, capabilities: inst?.capabilities || [] })}
                  >
                    <div className="sk-store-card-top">
                      <SkillIcon iconKey={sk.icon_key} iconUrl={sk.icon_url} size={44} />
                      <div className="sk-store-card-badges">
                        <span className={`sk-risk sk-risk-${sk.risk || 'mid'}`}>{t(`agentSettings.risk.${sk.risk || 'mid'}`)}</span>
                        {sk.id === 'atolla.browser' && (
                          <span className={`dbs-dot ${browserUse?.ok ? 'ok' : 'miss'}`} title={browserUse?.ok ? t('agentSettings.hint.browserOk') : t('agentSettings.hint.browserAuto')} />
                        )}
                      </div>
                    </div>
                    <h4 className="sk-store-card-title">{sk.name}</h4>
                    <p className="sk-store-card-desc">{sk.summary}</p>
                    <div className="sk-tags">
                      {skillTags(sk, t).map((tag) => <span key={tag} className="sk-tag">{tag}</span>)}
                    </div>
                  </button>
                  <div className="sk-store-card-foot">
                    <span className="sk-author">{sk.author || 'Atolla'} <em>v{sk.version || '1.0.0'}</em></span>
                    {inst ? (
                      <button type="button" className="sk-install-btn is-installed" disabled={busy || disabled} onClick={() => uninstall(sk.id)}>
                        {t('agentSettings.skillsInstalledUninstall')}
                      </button>
                    ) : (
                      <button type="button" className="sk-install-btn" disabled={busy || disabled} onClick={() => install(sk.id, defaultCaps(sk.capabilities))}>
                        <IconDownload size={13} />
                        {t('agentSettings.skillsInstall')}
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
                  <span className={`sk-risk sk-risk-${detail.risk || 'mid'}`}>{t(`agentSettings.risk.${detail.risk || 'mid'}`)}</span>
                  <span>{detail.author || 'Atolla'}</span>
                  <span>v{detail.version}</span>
                </div>
              </div>
            </div>
            <h4>{t('agentSettings.skillsRules')}</h4>
            <ul className="sk-rules">
              {(detail.rules || []).map((r, i) => (
                <li key={i} className={`sk-rule sk-rule-${r.type}`}>
                  <span>{t(`agentSettings.rule.${r.type === 'allow' || r.type === 'deny' ? r.type : 'note'}`)}</span>
                  {r.text}
                </li>
              ))}
            </ul>
            {!!(detail.all_capabilities || detail.capabilities)?.length && (
              <>
                <h4>{t('agentSettings.skillsCaps')}</h4>
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
              <button type="button" className="ghost" onClick={() => setDetail(null)}>{t('agentSettings.close')}</button>
              {detail.installed ? (
                <button type="button" className="ghost danger" disabled={busy || disabled} onClick={() => uninstall(detail.id)}>{t('agentSettings.uninstall')}</button>
              ) : (
                <button type="button" disabled={busy || disabled} onClick={() => install(detail.id, defaultCaps(detail.capabilities || detail.all_capabilities))}>
                  {t('agentSettings.skillsInstall')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {publishOpen && (
        <div className="modal-mask sk-detail-mask" onClick={() => !busy && setPublishOpen(false)}>
          <form className="modal-card sk-publish" onClick={(e) => e.stopPropagation()} onSubmit={publishCustom}>
            <h3>{t('agentSettings.skillsPublishTitle')}</h3>
            <p className="muted">{t('agentSettings.skillsPublishHint')}</p>
            <label>
              {t('agentSettings.name')}
              <input required value={pub.name} disabled={busy} onChange={(e) => setPub({ ...pub, name: e.target.value })} />
            </label>
            <label>
              {t('agentSettings.skillsSummary')}
              <input required value={pub.summary} disabled={busy} onChange={(e) => setPub({ ...pub, summary: e.target.value })} />
            </label>
            <label>
              {t('agentSettings.skillsDesc')}
              <textarea rows={3} value={pub.description} disabled={busy} onChange={(e) => setPub({ ...pub, description: e.target.value })} />
            </label>
            <label>
              {t('agentSettings.skillsRulesPh')}
              <textarea rows={4} value={pub.rules_text} disabled={busy} onChange={(e) => setPub({ ...pub, rules_text: e.target.value })} />
            </label>
            <div className="sk-publish-row">
              <label>
                {t('agentSettings.skillsIcon')}
                <select value={pub.icon_key} disabled={busy} onChange={(e) => setPub({ ...pub, icon_key: e.target.value })}>
                  {Object.keys(ICON_GLYPH).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label>
                {t('agentSettings.skillsRisk')}
                <select value={pub.risk} disabled={busy} onChange={(e) => setPub({ ...pub, risk: e.target.value })}>
                  <option value="low">{t('agentSettings.riskShort.low')}</option>
                  <option value="mid">{t('agentSettings.riskShort.mid')}</option>
                  <option value="high">{t('agentSettings.riskShort.high')}</option>
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => setPublishOpen(false)}>{t('agentSettings.cancel')}</button>
              <button type="submit" disabled={busy}>{busy ? t('agentSettings.skillsPublishing') : t('agentSettings.skillsPublishSubmit')}</button>
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

