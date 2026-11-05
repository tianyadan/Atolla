import { useEffect, useRef, useState } from 'react'
import './App.css'
import { CHANGELOG, CURRENT_VERSION } from './changelog.js'
import { ManagedAgentPermOverlay } from './ManagedAgents.jsx'
import GroupChats from './GroupChats.jsx'
import { anyAgentLoading } from './managedAgentSessions.js'
import { WorkflowPanel } from './workflow/index.js'
import WorkflowPermOverlay from './workflow/WorkflowPermOverlay.jsx'
import ProductManual from './ProductManual.jsx'
import PublicHome from './PublicHome.jsx'
import DigitalHumanCards from './DigitalHumanCards.jsx'
import VisitorAskAudit from './VisitorAskAudit.jsx'
import AgentAudit from './AgentAudit.jsx'
import LegacyMemoryShelf from './LegacyMemoryShelf.jsx'
import RemoteRelayPanel from './RemoteRelayPanel.jsx'
import NetworkPolicyPanel from './NetworkPolicyPanel.jsx'
import NotifySettings from './NotifySettings.jsx'
import LanguageSettings from './LanguageSettings.jsx'
import EngineOnboarding from './EngineOnboarding.jsx'
import EngineSettings from './EngineSettings.jsx'
import DbSettings from './DbSettings.jsx'
import WatchdogSettings from './WatchdogSettings.jsx'
import IslandSettings from './IslandSettings.jsx'
import JevSettings from './JevSettings.jsx'
import ModernWorkspace from './ModernWorkspace.jsx'
import { initLocale } from './i18n/locale.js'
import { useLocale } from './i18n/useLocale.js'

initLocale()

const API = '/api'
const AUTH_TOKEN_KEY = 'avatar_admin_token'
const ONBOARD_KEY = 'atolla_onboard_v1'
const CHANGELOG_PAGE_SIZE = 5
const MODERN_SIDEBAR_KEY = 'atolla_modern_sidebar_collapsed_v1'

/** 现代管理台模块标题；导航结构由 ModernWorkspace 负责。 */
function buildAdminLabels(t) {
  return {
    agents: t('nav.agents'),
    'agents-manage': t('nav.agentsManage'),
    'group-chats': t('nav.groupChats'),
    'legacy-memories': t('nav.legacyMemories'),
    audit: t('nav.audit'),
    'audit-agents': t('nav.auditAgents'),
    plans: t('nav.plans'),
    memos: t('nav.memos'),
    analytics: t('nav.analytics'),
    'remote-relay': t('nav.remoteRelay'),
    'network-allowlist': t('nav.networkAllowlist'),
    settings: t('nav.settings'),
    manual: t('nav.manual'),
    changelog: t('nav.changelog'),
  }
}

export default function App() {
  const { t } = useLocale()
  const adminLabels = buildAdminLabels(t)
  // 登录 / 视图
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY) || '')
  const [username, setUsername] = useState('')
  const [view, setView] = useState('chat') // chat | admin
  const [adminMenu, setAdminMenu] = useState('agents')
  const [focusAgentId, setFocusAgentId] = useState(0)
  const [focusApprovalRequestId, setFocusApprovalRequestId] = useState('')
  const [focusGroupId, setFocusGroupId] = useState(0)
  const [openAgentSettings, setOpenAgentSettings] = useState(false)
  const [openHire, setOpenHire] = useState(false)
  const [jumpWorkflowRunId, setJumpWorkflowRunId] = useState(0)
  const [loginOpen, setLoginOpen] = useState(false)
  const [needsRegister, setNeedsRegister] = useState(false)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginConfirm, setLoginConfirm] = useState('')
  const [showOnboard, setShowOnboard] = useState(() => !localStorage.getItem(ONBOARD_KEY) && !localStorage.getItem(AUTH_TOKEN_KEY))
  const [guideLogin, setGuideLogin] = useState(false)
  const [loginErr, setLoginErr] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [authChecking, setAuthChecking] = useState(!!localStorage.getItem(AUTH_TOKEN_KEY))
  const [clPage, setClPage] = useState(1) // 版本变更记录分页
  const [modernSidebarCollapsed, setModernSidebarCollapsed] = useState(() => localStorage.getItem(MODERN_SIDEBAR_KEY) === '1')
  const bgTokenRef = useRef('') // 登出后后台任务继续用的 token

  // 带管理员 JWT 的请求头(登出后若有后台任务则用 bgToken)
  function authHeaders(extra = {}) {
    const h = { ...extra }
    const tok = authToken || bgTokenRef.current
    if (tok) h.Authorization = `Bearer ${tok}`
    return h
  }

  // 清登录态并回对话页(不中断后台数字员工 SSE)
  function clearAuth(msg) {
    if (anyAgentLoading() && authToken) {
      bgTokenRef.current = authToken
    }
    localStorage.removeItem(AUTH_TOKEN_KEY)
    setAuthToken('')
    setUsername('')
    setView('chat')
    setLoginOpen(false)
    if (msg) setLoginErr(msg)
  }

  // 启动时校验本地 token；并消费 ?agent= / #agent= 深链（灵动岛跳转）
  useEffect(() => {
    if (!authToken) {
      setAuthChecking(false)
      return
    }
    let cancelled = false
    fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (r) => {
        if (cancelled) return
        if (!r.ok) {
          clearAuth('')
          return
        }
        const d = await r.json()
        setUsername(d.username || '')
        setAdminMenu('agents')
        setView('admin')
        void syncIslandToken(authToken)
        consumeAgentDeepLink()
      })
      .catch(() => { if (!cancelled) clearAuth('') })
      .finally(() => { if (!cancelled) setAuthChecking(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 灵动岛深链：可同时定位数字人与具体命令审批；保留 hash 便于岛复用已开标签。 */
  function consumeAgentDeepLink() {
    try {
      const q = new URLSearchParams(window.location.search || '')
      let aid = Number(q.get('agent') || 0)
      const hm = (window.location.hash || '').match(/^#?agent=(\d+)/i)
      if (!aid && hm) aid = Number(hm[1])
      const approvalId = String(q.get('approval_request_id') || '').trim()
      // 无 agent 但有审批 id 时仍进入管理台，审批卡由后续 pending 补齐
      if (aid > 0 || approvalId) {
        if (aid > 0) setFocusAgentId(aid)
        if (approvalId) setFocusApprovalRequestId(approvalId)
        setAdminMenu('agents')
        setView('admin')
        const url = new URL(window.location.href)
        url.searchParams.delete('agent')
        url.searchParams.delete('approval_request_id')
        url.searchParams.delete('_island')
        if (aid > 0) url.hash = `agent=${aid}`
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
      }
    } catch { /* ignore */ }
  }

  // 已打开的管理台被岛再次导航时（同标签改 URL / hash / pageshow），继续聚焦对应数字人与审批
  useEffect(() => {
    if (!authToken) return undefined
    const onHash = () => consumeAgentDeepLink()
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    // bfcache / 岛强制导航回来时再消费一次 query
    window.addEventListener('pageshow', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
      window.removeEventListener('pageshow', onHash)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken])

  /** 打开登录框时询问是否还要注册首位管理员。 */
  function openLogin() {
    setLoginErr('')
    setLoginOpen(true)
    fetch(`${API}/auth/setup`)
      .then((r) => r.json())
      .then((d) => {
        const need = !!d.needs_register
        setNeedsRegister(need)
        if (!need && !loginUser) setLoginUser('tianhaowen')
      })
      .catch(() => {})
  }

  /** 注册首位管理员并进入后台。 */
  async function doRegister(e) {
    e?.preventDefault?.()
    if (loginBusy) return
    if (loginPass !== loginConfirm) {
      setLoginErr('两次密码不一致')
      return
    }
    setLoginBusy(true)
    setLoginErr('')
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUser.trim(),
          password: loginPass,
          confirm_password: loginConfirm,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoginErr(d.error || '注册失败')
        return
      }
      finishAuth(d)
    } catch {
      setLoginErr('网络错误，请稍后重试')
    } finally {
      setLoginBusy(false)
    }
  }

  /** 把管理台 Token 同步到本机灵动岛（~/.atolla/island.json）。 */
  async function syncIslandToken(token) {
    const tok = String(token || '').trim()
    if (!tok) return
    try {
      // 岛请求必须走 127.0.0.1：localhost 在 macOS 常解析为 ::1，会被 AVATAR_ALLOWED_IPS=127.0.0.1 拦成 403
      const host = window.location.hostname
      const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
      const apiHost = loopback ? '127.0.0.1' : host
      const webBase = loopback
        ? `${window.location.protocol}//127.0.0.1${window.location.port ? `:${window.location.port}` : ''}`
        : window.location.origin
      await fetch(`${API}/admin/island/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_base: `${window.location.protocol}//${apiHost}:8080`,
          web_base: webBase,
        }),
      })
    } catch {
      /* 岛未装或不在本机时忽略 */
    }
  }

  /** 写入令牌并进入管理台。 */
  function finishAuth(d) {
    localStorage.setItem(AUTH_TOKEN_KEY, d.token)
    localStorage.setItem(ONBOARD_KEY, '1')
    setAuthToken(d.token)
    bgTokenRef.current = ''
    setUsername(d.username || loginUser.trim())
    setLoginPass('')
    setLoginConfirm('')
    setLoginOpen(false)
    setShowOnboard(false)
    setGuideLogin(false)
    setAdminMenu('agents')
    setView('admin')
    setLoginErr('')
    void syncIslandToken(d.token)
  }

  async function doLogin(e) {
    e?.preventDefault?.()
    if (needsRegister) return doRegister(e)
    if (loginBusy) return
    setLoginBusy(true)
    setLoginErr('')
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser.trim(), password: loginPass }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoginErr(d.error || '账号或密码错误')
        return
      }
      finishAuth(d)
    } catch {
      setLoginErr('网络错误，请稍后重试')
    } finally {
      setLoginBusy(false)
    }
  }

  async function doLogout() {
    try {
      await fetch(`${API}/auth/logout`, { method: 'POST', headers: authHeaders() })
    } catch { /* ignore */ }
    clearAuth('')
  }

  // —— 管理菜单 ——
  function switchAdminMenu(id) {
    setAdminMenu(id)
    if (id === 'changelog') setClPage(1)
  }

  function setModernSidebar(next) {
    setModernSidebarCollapsed(next)
    localStorage.setItem(MODERN_SIDEBAR_KEY, next ? '1' : '0')
  }

  function menuLabel(id) {
    return adminLabels[id] || ''
  }

  if (authChecking) {
    return <div className="app"><p className="empty">校验登录中…</p></div>
  }

  // 管理台布局
  if (view === 'admin') {
    return (
      <div className="app app-admin app-admin-modern">
        <div className="admin-layout">
          <main className={`admin-main${adminMenu !== 'agents' ? ` modern-module-open${modernSidebarCollapsed ? ' sidebar-collapsed' : ''}` : ''}`}>
            {adminMenu !== 'agents' && (
              <div className="modern-module-bar">
                <button type="button" onClick={() => switchAdminMenu('agents')}>← 返回对话</button>
                <strong>{menuLabel(adminMenu)}</strong>
              </div>
            )}
            {adminMenu === 'audit' && (
              <VisitorAskAudit
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                active={adminMenu === 'audit'}
              />
            )}
            {adminMenu === 'audit-agents' && (
              <AgentAudit
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                active={adminMenu === 'audit-agents'}
              />
            )}
            {/* 始终挂载现代工作台，切换模块时保留数字人 SSE 与运行状态。 */}
            <div className={`modern-workspace-host${adminMenu === 'agents' ? '' : ' is-sidebar-only'}${modernSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
              <ModernWorkspace
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                username={username}
                showChat={adminMenu === 'agents'}
                sidebarCollapsed={modernSidebarCollapsed}
                onSidebarCollapsedChange={setModernSidebar}
                focusAgentId={focusAgentId}
                focusApprovalRequestId={focusApprovalRequestId}
                openSettings={openAgentSettings}
                openHire={openHire}
                onFocusConsumed={() => { setFocusAgentId(0); setOpenAgentSettings(false) }}
                onApprovalFocusConsumed={() => setFocusApprovalRequestId('')}
                onHireConsumed={() => setOpenHire(false)}
                onLogout={doLogout}
                onOpenFrontend={() => setView('chat')}
                onOpenMenu={switchAdminMenu}
                onOpenWorkflowRun={(runId) => { setJumpWorkflowRunId(runId); switchAdminMenu('plans') }}
                onOpenGroupChat={(groupId) => { setFocusGroupId(Number(groupId) || 0); switchAdminMenu('group-chats') }}
              />
            </div>
            {adminMenu === 'group-chats' && (
              <GroupChats
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                active={adminMenu === 'group-chats'}
                focusGroupId={focusGroupId}
                onFocusConsumed={() => setFocusGroupId(0)}
              />
            )}
            {adminMenu === 'agents-manage' && (
              <DigitalHumanCards
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                active={adminMenu === 'agents-manage'}
                onHire={() => { setOpenHire(true); switchAdminMenu('agents') }}
                onOpenSettings={(a) => {
                  setFocusAgentId(a.id)
                  setOpenAgentSettings(true)
                  switchAdminMenu('agents')
                }}
              />
            )}
            {adminMenu === 'legacy-memories' && (
              <LegacyMemoryShelf
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                active={adminMenu === 'legacy-memories'}
              />
            )}
            {/* 部署任务切换菜单后仍继续接收 SSE；页面仅隐藏，不卸载。 */}
            <RemoteRelayPanel
              authHeaders={authHeaders}
              onUnauthorized={() => clearAuth('登录已过期')}
              active={adminMenu === 'remote-relay'}
            />
            {/* 安装 JEV/灵动岛可能持续数分钟；仅隐藏而不卸载设置页，避免切换菜单后丢失安装进度与错误。 */}
            <section
              className="settings-page"
              style={{ display: adminMenu === 'settings' ? undefined : 'none' }}
            >
                <h2 className="settings-page-title">{t('settings.title')}</h2>
                <LanguageSettings />
                <NotifySettings
                  authHeaders={authHeaders}
                  onUnauthorized={() => clearAuth('登录已过期')}
                  active={adminMenu === 'settings'}
                />
                <WatchdogSettings
                  authHeaders={authHeaders}
                  onUnauthorized={() => clearAuth('登录已过期')}
                  active={adminMenu === 'settings'}
                />
                <IslandSettings
                  authHeaders={authHeaders}
                  onUnauthorized={() => clearAuth('登录已过期')}
                  active={adminMenu === 'settings'}
                />
                <JevSettings
                  authHeaders={authHeaders}
                  onUnauthorized={() => clearAuth('登录已过期')}
                  active={adminMenu === 'settings'}
                />
                <EngineSettings
                  authHeaders={authHeaders}
                  onUnauthorized={() => clearAuth('登录已过期')}
                  active={adminMenu === 'settings'}
                />
                <DbSettings
                  authHeaders={authHeaders}
                  onUnauthorized={() => clearAuth('登录已过期')}
                  active={adminMenu === 'settings'}
                />
            </section>
            {adminMenu === 'network-allowlist' && (
              <NetworkPolicyPanel
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                active={adminMenu === 'network-allowlist'}
              />
            )}
            <div style={{ display: adminMenu === 'plans' ? 'block' : 'none' }}>
              <WorkflowPanel
                authHeaders={authHeaders}
                onUnauthorized={() => clearAuth('登录已过期')}
                jumpRunId={jumpWorkflowRunId}
                onJumpConsumed={() => setJumpWorkflowRunId(0)}
              />
            </div>
            {adminMenu === 'manual' && <ProductManual />}
            {adminMenu === 'changelog' && (() => {
              const total = CHANGELOG.length
              const pages = Math.max(1, Math.ceil(total / CHANGELOG_PAGE_SIZE))
              const page = Math.min(clPage, pages)
              const slice = CHANGELOG.slice((page - 1) * CHANGELOG_PAGE_SIZE, page * CHANGELOG_PAGE_SIZE)
              return (
                <section className="list changelog">
                  <p className="empty-hint">版本变更记录 · 当前 {CURRENT_VERSION} · 每页 {CHANGELOG_PAGE_SIZE} 条 · 共 {total} 个版本</p>
                  {slice.map((v) => (
                    <article key={v.version} className="version-card">
                      <div className="version-head">
                        <span className="version-tag">{v.version}</span>
                        <span className="version-date">{v.date}</span>
                      </div>
                      <ul>
                        {(v.items || []).map((it, i) => <li key={i}>{it}</li>)}
                      </ul>
                    </article>
                  ))}
                  <div className="pager">
                    <button type="button" disabled={page <= 1} onClick={() => setClPage(page - 1)}>上一页</button>
                    <span>第 {page} / {pages} 页</span>
                    <button type="button" disabled={page >= pages} onClick={() => setClPage(page + 1)}>下一页</button>
                  </div>
                </section>
              )
            })()}
            {!['audit', 'audit-agents', 'agents', 'agents-manage', 'group-chats', 'legacy-memories', 'remote-relay', 'network-allowlist', 'settings', 'plans', 'manual', 'changelog'].includes(adminMenu) && (
              <section className="admin-placeholder">
                <h2>{menuLabel(adminMenu)}</h2>
                <p>即将开放</p>
              </section>
            )}
          </main>
        </div>
        {/* 始终挂载：数字人页内 sticky 审批卡可能被滚出/会话错位；浮层兜底保证 PC 可见可裁决 */}
        <ManagedAgentPermOverlay
          authHeaders={authHeaders}
          onUnauthorized={() => clearAuth('登录已过期')}
        />
        {authToken && (
          <WorkflowPermOverlay
            authHeaders={authHeaders}
            onUnauthorized={() => clearAuth('登录已过期')}
          />
        )}
      </div>
    )
  }

  return (
    <div className="app app-public">
      {showOnboard && !authToken && (
        <EngineOnboarding onReady={() => {
          localStorage.setItem(ONBOARD_KEY, '1')
          setShowOnboard(false)
          setGuideLogin(true)
        }} />
      )}
      <PublicHome
        authToken={authToken}
        guideLogin={guideLogin && !authToken}
        onLogin={openLogin}
        onOpenAdmin={() => { setView('admin'); setAdminMenu('agents') }}
      />

      {loginOpen && (
        <div className="modal-mask" onClick={() => !loginBusy && setLoginOpen(false)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={doLogin}>
            <h2>{needsRegister ? '注册管理员' : '管理员登录'}</h2>
            {needsRegister && <p className="engine-note">首次登录需要先注册，这个账号将成为本机管理员。</p>}
            <label>
              账号
              <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" disabled={loginBusy} />
            </label>
            <label>
              密码
              <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} autoComplete={needsRegister ? 'new-password' : 'current-password'} disabled={loginBusy} />
            </label>
            {needsRegister && (
              <label>
                确认密码
                <input type="password" value={loginConfirm} onChange={(e) => setLoginConfirm(e.target.value)} autoComplete="new-password" disabled={loginBusy} />
              </label>
            )}
            {loginErr && <p className="login-err">{loginErr}</p>}
            <div className="modal-actions">
              <button type="button" disabled={loginBusy} onClick={() => setLoginOpen(false)}>取消</button>
              <button type="submit" disabled={loginBusy}>{loginBusy ? '提交中…' : (needsRegister ? '注册并进入' : '登录')}</button>
            </div>
          </form>
        </div>
      )}

      <footer className="app-footer ph-footer">当前版本 {CURRENT_VERSION}</footer>
      {/* 数字人面板仅挂一份：菜单切换用 display:none 保活 SSE；勿再挂隐藏副本，否则双实例抢选中/串会话 */}
      <ManagedAgentPermOverlay
        authHeaders={authHeaders}
        onUnauthorized={() => clearAuth('登录已过期')}
      />
    </div>
  )
}
