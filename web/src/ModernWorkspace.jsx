import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles/modern-workspace.css'
import ManagedAgentsPanel from './ManagedAgents.jsx'
import JellyAvatar from './JellyAvatar.jsx'
import { jellyStateFromPhase, resolveJellyColor } from './jellyColor.js'
import { getAgentSession, subscribeAgentSessions } from './managedAgentSessions.js'
import { ModernIcon } from './modernWorkspaceIcons.jsx'
import DismissAgentModal from './DismissAgentModal.jsx'
import AgentGroupManager from './AgentGroupManager.jsx'
import { CURRENT_VERSION } from './changelog.js'
import {
  conversationDisplayTitle,
  conversationNeedsActivation,
  filterConversationSummaries,
  groupRecentConversations,
  highestAgentState,
  sortConversationSummaries,
  uniqueLatestAgentConversations,
} from './modernWorkspaceModel.js'
import { useLocale } from './i18n/useLocale.js'
import { POLL_IDLE_MS, createSingleFlight, subscribePageVisible } from './pollScheduler.js'

const API = '/api'

/** 更多菜单分组（随界面语言） */
function buildMoreGroups(t) {
  return [
    [
      { id: 'agents-manage', label: t('nav.agentsManage'), icon: 'robot' },
      { id: 'group-chats', label: t('nav.groupChats'), icon: 'chat' },
      { id: 'plans', label: t('nav.plans'), icon: 'folder' },
      { id: 'audit', label: t('nav.audit'), icon: 'shield' },
    ],
    [
      { id: 'audit-agents', label: t('nav.auditAgents'), icon: 'document' },
      { id: 'legacy-memories', label: t('nav.legacyMemories'), icon: 'clock' },
      { id: 'remote-relay', label: t('nav.remoteRelay'), icon: 'monitor' },
      { id: 'network-allowlist', label: t('nav.networkAllowlist'), icon: 'globe' },
    ],
    [
      { id: 'app', label: t('nav.app'), icon: 'phone' },
      { id: 'settings', label: t('nav.settings'), icon: 'settings' },
      { id: 'manual', label: t('nav.manual'), icon: 'book' },
    ],
  ]
}

export default function ModernWorkspace({
  authHeaders,
  onUnauthorized,
  onOpenMenu,
  onLogout,
  onOpenFrontend,
  focusAgentId = 0,
  focusApprovalRequestId = '',
  openSettings = false,
  openHire = false,
  onFocusConsumed,
  onApprovalFocusConsumed,
  onHireConsumed,
  onOpenWorkflowRun,
  onOpenGroupChat,
  username = '',
  showChat = true,
  sidebarCollapsed = false,
  onSidebarCollapsedChange,
}) {
  const { t } = useLocale()
  const moreGroups = useMemo(() => buildMoreGroups(t), [t])
  const [conversations, setConversations] = useState([])
  const [folders, setFolders] = useState([])
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [hireOpen, setHireOpen] = useState(false)
  const [hireGroupOpen, setHireGroupOpen] = useState(false)
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [hireFolderId, setHireFolderId] = useState('0')
  const [moreOpen, setMoreOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [dismissTarget, setDismissTarget] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [hoverAgent, setHoverAgent] = useState(null)
  const [, setAgentSessionVersion] = useState(0)
  const accountCloseTimer = useRef(0)
  const moreMenuRef = useRef(null)

  function openAccountMenu() {
    window.clearTimeout(accountCloseTimer.current)
    setMoreOpen(false)
    setAccountOpen(true)
  }

  function scheduleAccountMenuClose() {
    window.clearTimeout(accountCloseTimer.current)
    // 给鼠标跨过头像与浮层边缘留出缓冲，避免菜单一闪而过。
    accountCloseTimer.current = window.setTimeout(() => setAccountOpen(false), 220)
  }

  useEffect(() => () => window.clearTimeout(accountCloseTimer.current), [])

  // 左侧数字人菜单与对话区共用实时会话阶段，避免菜单动画停留在默认跳动状态。
  useEffect(() => subscribeAgentSessions(() => {
    setAgentSessionVersion((value) => value + 1)
  }), [])

  useEffect(() => {
    if (!moreOpen) return undefined
    function closeOnOutside(event) {
      if (!moreMenuRef.current?.contains(event.target)) setMoreOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])

  function openMoreModule(id) {
    setMoreOpen(false)
    onOpenMenu?.(id)
  }

  const request = useCallback(async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) })
    if (response.status === 401) {
      onUnauthorized?.()
      throw new Error('登录已过期')
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '请求失败')
    return data
  }, [authHeaders, onUnauthorized])

  const loadConversations = useCallback(async () => {
    try {
      const data = await request(`${API}/admin/agent-conversations`)
      const items = data.items || []
      setConversations(items)
      setSelected((current) => current && items.some((item) => item.id === current.id)
        ? items.find((item) => item.id === current.id)
        : items.find((item) => item.active) || items[0] || null)
    } catch (err) {
      setError(err.message)
    }
  }, [request])

  const loadFolders = useCallback(async () => {
    try {
      const data = await request(`${API}/admin/agent-folders`)
      setFolders(data.items || [])
    } catch (err) {
      setError(err.message)
    }
  }, [request])

  useEffect(() => {
    loadConversations()
    loadFolders()
  }, [loadConversations, loadFolders])

  useEffect(() => {
    if (openHire) setHireGroupOpen(true)
  }, [openHire])

  const sidebarFlightRef = useRef(null)
  if (!sidebarFlightRef.current) sidebarFlightRef.current = createSingleFlight()

  // 最近活跃、终态未读和排序需要跟随任务进度更新；隐藏窗口暂停，空闲 8s。
  useEffect(() => {
    let stopped = false
    let visible = document.visibilityState === 'visible'
    const pull = () => {
      if (stopped || !visible) return
      void sidebarFlightRef.current('sidebar', async () => {
        try { await loadConversations() } catch { /* ignore */ }
      })
    }
    const timer = window.setInterval(pull, POLL_IDLE_MS)
    const unsub = subscribePageVisible((v) => {
      visible = v
      if (v) pull()
    })
    return () => {
      stopped = true
      window.clearInterval(timer)
      unsub()
    }
  }, [loadConversations])

  useEffect(() => {
    if (!focusAgentId) return
    const target = conversations.find((item) => Number(item.agent_id) === Number(focusAgentId) && item.active)
      || conversations.find((item) => Number(item.agent_id) === Number(focusAgentId))
    if (target) setSelected(target)
  }, [focusAgentId, conversations])

  const ungrouped = t('modern.ungrouped')
  /** 真实分组名；未分组用哨兵值，避免切语言后筛选项错位 */
  const groupsAvailable = useMemo(() => {
    const names = new Set()
    let hasUngrouped = false
    for (const folder of folders) {
      if (folder.name) names.add(folder.name)
    }
    for (const item of conversations) {
      if (item.group_name) names.add(item.group_name)
      else hasUngrouped = true
    }
    const list = [...names]
    if (hasUngrouped) list.unshift('__ungrouped__')
    return list
  }, [folders, conversations])
  const filtered = useMemo(
    () => sortConversationSummaries(
      filterConversationSummaries(conversations, query).filter((item) => {
        if (!groupFilter) return true
        if (groupFilter === '__ungrouped__') return !item.group_name
        return item.group_name === groupFilter
      }),
    ),
    [conversations, query, groupFilter],
  )
  const uniqueAgents = useMemo(() => uniqueLatestAgentConversations(filtered), [filtered])
  const groups = useMemo(
    () => groupRecentConversations(uniqueAgents, new Date(), {
      today: t('modern.today'),
      yesterday: t('modern.yesterday'),
      last7Days: t('modern.last7Days'),
      earlier: t('modern.earlier'),
    }),
    [uniqueAgents, t],
  )

  function showAgentTooltip(event, item, state) {
    const avatarRect = event.currentTarget.getBoundingClientRect()
    const sidebarRect = event.currentTarget.closest('.modern-recents')?.getBoundingClientRect()
    setHoverAgent({
      item,
      state,
      top: Math.max(8, Math.min(avatarRect.top - 12, window.innerHeight - 116)),
      left: (sidebarRect?.right || avatarRect.right) + 9,
    })
  }

  function stateText(state) {
    return (
      {
        error: t('modern.state.error'),
        approval: t('modern.state.approval'),
        running: t('modern.state.running'),
        completed: t('modern.state.completed'),
        idle: t('modern.state.idle'),
      }[state] || t('modern.state.idle')
    )
  }

  async function activateConversation(item) {
    if (!conversationNeedsActivation(item)) {
      setSelected({ ...item, active: true })
      setRefreshKey((value) => value + 1)
      setDrawerOpen(false)
      if (!showChat) onOpenMenu?.('agents')
      return
    }
    try {
      setError('')
      await request(`${API}/admin/agents/${item.agent_id}/conversations/${item.id}/activate`, { method: 'POST' })
      setSelected({ ...item, active: true })
      setRefreshKey((value) => value + 1)
      setDrawerOpen(false)
      await loadConversations()
      if (!showChat) onOpenMenu?.('agents')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAgentHired(agent) {
    try {
      if (agent?.id && Number(hireFolderId) > 0) {
        await request(`${API}/admin/agents/${agent.id}/folder`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: Number(hireFolderId) }),
        })
      }
      await loadConversations()
      await loadFolders()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className={`modern-workspace${sidebarCollapsed ? ' is-collapsed' : ''}${showChat ? '' : ' is-sidebar-only'}`}>
      <button className="modern-drawer-toggle" type="button" onClick={() => setDrawerOpen(true)} aria-label={t('modern.openRecents')}>
        <ModernIcon name="panel" />
      </button>
      <aside className={`modern-recents${drawerOpen ? ' is-open' : ''}`}>
        <div className="modern-sidebar-top">
          <div className="modern-sidebar-brand" title={t('modern.brand')}>
            <ModernIcon name="agents" size={18} />
            <strong>{t('modern.brand')}</strong>
          </div>
          <div className="modern-sidebar-actions">
            <button
              type="button"
              className="modern-icon-btn modern-hire-btn"
              onClick={() => setHireGroupOpen(true)}
              title={t('modern.hire')}
              aria-label={t('modern.hire')}
            >
              <ModernIcon name="plus" size={18} />
            </button>
            <button
              type="button"
              className="modern-collapse-toggle"
              onClick={() => onSidebarCollapsedChange?.(!sidebarCollapsed)}
              title={sidebarCollapsed ? t('modern.expandSidebar') : t('modern.collapseSidebar')}
              aria-label={sidebarCollapsed ? t('modern.expandSidebar') : t('modern.collapseSidebar')}
            >
              <ModernIcon name="panel" size={18} />
            </button>
          </div>
        </div>
        <label className="modern-search">
          <ModernIcon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('modern.searchPlaceholder')}
          />
        </label>
        <div className="modern-group-filter-row">
          <label className="modern-group-filter">
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} aria-label={t('modern.selectGroup')}>
              <option value="">{t('modern.allGroups')}</option>
              {groupsAvailable.map((name) => (
                <option key={name} value={name}>
                  {name === '__ungrouped__' ? ungrouped : name}
                </option>
              ))}
            </select>
            <ModernIcon name="chevron-down" size={16} />
          </label>
          <button
            type="button"
            className="modern-group-manage-btn"
            onClick={() => setGroupManagerOpen(true)}
            title={t('modern.manageGroups')}
            aria-label={t('modern.manageGroups')}
          >
            <ModernIcon name="settings" size={16} />
          </button>
        </div>
        <div className="modern-recent-scroll">
          {groups.map((group) => (
            <div className="modern-recent-group" key={group.label}>
              <h3>{group.label}</h3>
              {group.items.map((item) => {
                const session = getAgentSession(item.agent_id)
                const state = session.loading || session.compressing ? 'running' : highestAgentState(item)
                const jellyState = state === 'error'
                  ? 'error'
                  : state === 'approval'
                    ? 'waiting'
                    : state === 'running'
                      ? jellyStateFromPhase(session.agentPhase, 'working')
                      : 'idle'
                return (
                  <div key={item.id} className={`modern-recent-item${selected?.id === item.id ? ' active' : ''}`}>
                    <button type="button" className="modern-recent-main" onClick={() => activateConversation(item)}>
                      <span
                        className="modern-jelly-wrap"
                        aria-label={`${item.agent_name}, ${item.group_name || ungrouped}, ${stateText(state)}`}
                        onMouseEnter={(event) => showAgentTooltip(event, item, state)}
                        onMouseLeave={() => setHoverAgent(null)}
                      >
                        <JellyAvatar color={resolveJellyColor({ id: item.agent_id, jelly_color: item.jelly_color })} size={24} state={jellyState} />
                        <span className={`modern-state state-${state}`} />
                      </span>
                      <span><strong>{conversationDisplayTitle(item)}</strong><small>{item.agent_name} · {item.group_name}</small></span>
                    </button>
                    {!sidebarCollapsed && (
                      <button
                        type="button"
                        className="modern-dismiss-agent"
                        title={t('modern.dismiss', { name: item.agent_name })}
                        aria-label={t('modern.dismiss', { name: item.agent_name })}
                        onClick={(event) => {
                          event.stopPropagation()
                          setHoverAgent(null)
                          setDismissTarget({ id: item.agent_id, name: item.agent_name })
                        }}
                      >
                        <ModernIcon name="dismiss" size={16} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {!groups.length && <p className="modern-empty">{t('modern.emptyChats')}</p>}
        </div>
        <div className="modern-account-row">
          <div
            className="modern-account-profile"
            onMouseEnter={openAccountMenu}
            onMouseLeave={scheduleAccountMenuClose}
            onFocus={openAccountMenu}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleAccountMenuClose()
            }}
          >
            <button type="button" className="modern-account-trigger" aria-label={t('modern.accountMenu')} aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>
              <span className="modern-user-avatar" aria-hidden="true">{String(username || 'U').slice(0, 1).toUpperCase()}</span>
              <span className="modern-user-name">{username || t('modern.user')}</span>
            </button>
            {accountOpen && (
              <div className="modern-account-menu">
                <button type="button" onClick={onOpenFrontend}>{t('top.frontendChat')}</button>
                <hr />
                <button type="button" className="danger-item" onClick={onLogout}>{t('top.logoutFull')}</button>
              </div>
            )}
          </div>
          <div className={`modern-more-wrap${moreOpen ? ' is-open' : ''}`} ref={moreMenuRef}>
            <button
              type="button"
              className={`modern-icon-btn modern-more-trigger${moreOpen ? ' is-open' : ''}`}
              onClick={() => {
                setAccountOpen(false)
                setMoreOpen((value) => !value)
              }}
              aria-label={t('modern.more')}
              aria-expanded={moreOpen}
              aria-controls="modern-more-menu"
            >
              <ModernIcon name="menu" />
            </button>
            <div
              id="modern-more-menu"
              className={`modern-more-menu${moreOpen ? ' is-open' : ''}`}
              role="menu"
              aria-hidden={!moreOpen}
            >
              {moreGroups.map((group, groupIndex) => (
                <div className="modern-more-group" key={group[0].id}>
                  {group.map((item, itemIndex) => (
                    <button
                      type="button"
                      className="modern-more-item"
                      role="menuitem"
                      tabIndex={moreOpen ? 0 : -1}
                      key={item.id}
                      style={{ '--menu-index': groupIndex * 4 + itemIndex }}
                      onClick={() => openMoreModule(item.id)}
                    >
                      <ModernIcon name={item.icon} size={18} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
              <button
                type="button"
                className="modern-more-version"
                role="menuitem"
                tabIndex={moreOpen ? 0 : -1}
                onClick={() => openMoreModule('changelog')}
                title={t('modern.viewChangelog')}
              >
                <ModernIcon name="info" size={17} />
                <span>Atolla</span>
                <small>{CURRENT_VERSION}</small>
              </button>
            </div>
          </div>
        </div>
      </aside>
      {hoverAgent && (
        <div className="modern-agent-tooltip" role="tooltip" style={{ top: hoverAgent.top, left: hoverAgent.left }}>
          <strong>{hoverAgent.item.agent_name}</strong>
          <span>{hoverAgent.item.group_name || ungrouped}</span>
          <em className={`state-${hoverAgent.state}`}><i />{stateText(hoverAgent.state)}</em>
        </div>
      )}
      {drawerOpen && <button type="button" className="modern-drawer-mask" onClick={() => setDrawerOpen(false)} aria-label={t('modern.closeRecents')} />}
      <main className="modern-chat-stage">
        {error && <div className="modern-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
        <ManagedAgentsPanel
          authHeaders={authHeaders}
          onUnauthorized={onUnauthorized}
          active={showChat}
          conversationRefreshKey={refreshKey}
          openHire={hireOpen || openHire}
          openSettings={openSettings}
          onHireConsumed={() => { setHireOpen(false); onHireConsumed?.() }}
          onAgentHired={handleAgentHired}
          // 灵动岛深链优先于侧栏当前选中，否则审批跳转会被旧 selected 盖住
          focusAgentId={Number(focusAgentId) > 0 ? focusAgentId : (selected?.agent_id || 0)}
          focusApprovalRequestId={focusApprovalRequestId}
          onFocusConsumed={onFocusConsumed}
          onApprovalFocusConsumed={onApprovalFocusConsumed}
          onOpenWorkflowRun={onOpenWorkflowRun}
          onOpenGroupChat={onOpenGroupChat}
        />
      </main>
      {hireGroupOpen && (
        <div className="modal-mask" onMouseDown={() => { setHireGroupOpen(false); onHireConsumed?.() }}>
          <div className="modal-card modern-hire-group" onMouseDown={(event) => event.stopPropagation()}>
            <h2>{t('modern.pickGroupTitle')}</h2>
            <p className="muted">{t('modern.pickGroupHint')}</p>
            <label>
              {t('modern.workGroup')}
              <select value={hireFolderId} onChange={(event) => setHireFolderId(event.target.value)}>
                <option value="0">{ungrouped}</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => { setHireGroupOpen(false); onHireConsumed?.() }}>{t('modern.cancel')}</button>
              <button type="button" className="primary" onClick={() => { setHireGroupOpen(false); setHireOpen(true) }}>{t('modern.enterMarket')}</button>
            </div>
          </div>
        </div>
      )}
      <AgentGroupManager
        open={groupManagerOpen}
        authHeaders={authHeaders}
        onUnauthorized={onUnauthorized}
        onClose={() => setGroupManagerOpen(false)}
        onChanged={async () => {
          await Promise.all([loadFolders(), loadConversations()])
          setRefreshKey((value) => value + 1)
        }}
      />
      <DismissAgentModal
        open={!!dismissTarget}
        agents={dismissTarget ? [dismissTarget] : []}
        authHeaders={authHeaders}
        onUnauthorized={onUnauthorized}
        onClose={() => setDismissTarget(null)}
        onDone={async () => {
          setDismissTarget(null)
          await loadConversations()
          setRefreshKey((value) => value + 1)
        }}
      />
    </section>
  )
}
