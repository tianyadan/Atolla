import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ManagedAgentsPanel from './ManagedAgents.jsx'
import JellyAvatar from './JellyAvatar.jsx'
import { resolveJellyColor } from './jellyColor.js'
import { ModernIcon } from './modernWorkspaceIcons.jsx'
import DismissAgentModal from './DismissAgentModal.jsx'
import {
  conversationDisplayTitle,
  conversationNeedsActivation,
  filterConversationSummaries,
  groupRecentConversations,
  highestAgentState,
  sortConversationSummaries,
  uniqueLatestAgentConversations,
} from './modernWorkspaceModel.js'

const API = '/api'
const MORE_ITEMS = [
  ['agents-manage', '数字人管理'], ['group-chats', '群聊'], ['plans', '项目协作'],
  ['audit', '对话审计'], ['audit-agents', '审计'], ['legacy-memories', '数字员工记忆'],
  ['remote-relay', '远程中继'], ['network-allowlist', '网络白名单'], ['settings', '设置'],
  ['manual', '产品手册'], ['changelog', '版本记录'],
]

export default function ModernWorkspace({
  authHeaders,
  onUnauthorized,
  onOpenMenu,
  onUseClassic,
  onLogout,
  onOpenFrontend,
  focusAgentId = 0,
  focusApprovalRequestId = '',
  onFocusConsumed,
  onApprovalFocusConsumed,
  onOpenWorkflowRun,
  onOpenGroupChat,
  username = '',
  showChat = true,
  sidebarCollapsed = false,
  onSidebarCollapsedChange,
}) {
  const [conversations, setConversations] = useState([])
  const [folders, setFolders] = useState([])
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [hireOpen, setHireOpen] = useState(false)
  const [hireGroupOpen, setHireGroupOpen] = useState(false)
  const [hireFolderId, setHireFolderId] = useState('0')
  const [moreOpen, setMoreOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [dismissTarget, setDismissTarget] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [hoverAgent, setHoverAgent] = useState(null)
  const accountCloseTimer = useRef(0)

  function openAccountMenu() {
    window.clearTimeout(accountCloseTimer.current)
    setAccountOpen(true)
  }

  function scheduleAccountMenuClose() {
    window.clearTimeout(accountCloseTimer.current)
    // 给鼠标跨过头像与浮层边缘留出缓冲，避免菜单一闪而过。
    accountCloseTimer.current = window.setTimeout(() => setAccountOpen(false), 220)
  }

  useEffect(() => () => window.clearTimeout(accountCloseTimer.current), [])

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

  useEffect(() => {
    loadConversations()
    request(`${API}/admin/agent-folders`).then((data) => setFolders(data.items || [])).catch((err) => setError(err.message))
  }, [loadConversations, request])

  // 最近活跃、终态未读和排序需要跟随任务进度更新，侧栏保持轻量轮询。
  useEffect(() => {
    const timer = window.setInterval(loadConversations, 5000)
    return () => window.clearInterval(timer)
  }, [loadConversations])

  useEffect(() => {
    if (!focusAgentId) return
    const target = conversations.find((item) => Number(item.agent_id) === Number(focusAgentId) && item.active)
      || conversations.find((item) => Number(item.agent_id) === Number(focusAgentId))
    if (target) setSelected(target)
  }, [focusAgentId, conversations])

  const groupsAvailable = useMemo(() => [...new Set(['未分组', ...folders.map((folder) => folder.name), ...conversations.map((item) => item.group_name || '未分组')])], [folders, conversations])
  const filtered = useMemo(() => sortConversationSummaries(filterConversationSummaries(conversations, query)
    .filter((item) => !groupFilter || (item.group_name || '未分组') === groupFilter)), [conversations, query, groupFilter])
  const uniqueAgents = useMemo(() => uniqueLatestAgentConversations(filtered), [filtered])
  const groups = useMemo(() => groupRecentConversations(uniqueAgents), [uniqueAgents])

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
    return ({ error: '执行报错', approval: '等待审批', running: '运行中', completed: '已完成 · 未读', idle: '空闲' })[state] || '空闲'
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
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className={`modern-workspace${sidebarCollapsed ? ' is-collapsed' : ''}${showChat ? '' : ' is-sidebar-only'}`}>
      <button className="modern-drawer-toggle" type="button" onClick={() => setDrawerOpen(true)} aria-label="打开最近对话">
        <ModernIcon name="panel" />
      </button>
      <aside className={`modern-recents${drawerOpen ? ' is-open' : ''}`}>
        <div className="modern-sidebar-top">
          <button type="button" className="modern-new-chat" onClick={() => setHireGroupOpen(true)} title="招聘新员工"><ModernIcon name="plus" /><span>招聘新员工</span></button>
          <button type="button" className="modern-collapse-toggle" onClick={() => onSidebarCollapsedChange?.(!sidebarCollapsed)} title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}><ModernIcon name="panel" /></button>
        </div>
        <label className="modern-search"><ModernIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索数字人名称" /></label>
        <select className="modern-group-filter" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} aria-label="选择分组">
          <option value="">全部分组</option>
          {groupsAvailable.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className="modern-recent-scroll">
          {groups.map((group) => (
            <div className="modern-recent-group" key={group.label}>
              <h3>{group.label}</h3>
              {group.items.map((item) => {
                const state = highestAgentState(item)
                return (
                  <div key={item.id} className={`modern-recent-item${selected?.id === item.id ? ' active' : ''}`}>
                    <button type="button" className="modern-recent-main" onClick={() => activateConversation(item)}>
                      <span
                        className="modern-jelly-wrap"
                        aria-label={`${item.agent_name}，${item.group_name || '未分组'}，${stateText(state)}`}
                        onMouseEnter={(event) => showAgentTooltip(event, item, state)}
                        onMouseLeave={() => setHoverAgent(null)}
                      >
                        <JellyAvatar color={resolveJellyColor({ id: item.agent_id, jelly_color: item.jelly_color })} size={28} state={state === 'error' ? 'error' : state === 'approval' ? 'waiting' : state === 'running' ? 'working' : 'idle'} />
                        <span className={`modern-state state-${state}`} />
                      </span>
                      <span><strong>{conversationDisplayTitle(item)}</strong><small>{item.agent_name} · {item.group_name}</small></span>
                    </button>
                    {!sidebarCollapsed && (
                      <button
                        type="button"
                        className="modern-dismiss-agent"
                        title={`解聘 ${item.agent_name}`}
                        aria-label={`解聘 ${item.agent_name}`}
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
          {!groups.length && <p className="modern-empty">还没有对话</p>}
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
            <button type="button" className="modern-account-trigger" aria-label="账户菜单" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>
              <span className="modern-user-avatar" aria-hidden="true">{String(username || 'U').slice(0, 1).toUpperCase()}</span>
              <span className="modern-user-name">{username || '用户'}</span>
            </button>
            {accountOpen && (
              <div className="modern-account-menu">
                <button type="button" onClick={onOpenFrontend}>前台对话</button>
                <button type="button" onClick={onUseClassic}>切换经典风格</button>
                <hr />
                <button type="button" className="danger-item" onClick={onLogout}>退出登录</button>
              </div>
            )}
          </div>
          <button type="button" className="modern-icon-btn" onClick={() => setMoreOpen((value) => !value)} aria-label="更多功能"><ModernIcon name="menu" /></button>
          {moreOpen && (
            <div className="modern-more-menu">
              {MORE_ITEMS.map(([id, label]) => <button type="button" key={id} onClick={() => { setMoreOpen(false); onOpenMenu?.(id) }}>{label}</button>)}
            </div>
          )}
        </div>
      </aside>
      {hoverAgent && (
        <div className="modern-agent-tooltip" role="tooltip" style={{ top: hoverAgent.top, left: hoverAgent.left }}>
          <strong>{hoverAgent.item.agent_name}</strong>
          <span>{hoverAgent.item.group_name || '未分组'}</span>
          <em className={`state-${hoverAgent.state}`}><i />{stateText(hoverAgent.state)}</em>
        </div>
      )}
      {drawerOpen && <button type="button" className="modern-drawer-mask" onClick={() => setDrawerOpen(false)} aria-label="关闭最近对话" />}
      <main className="modern-chat-stage">
        {error && <div className="modern-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
        <ManagedAgentsPanel
          authHeaders={authHeaders}
          onUnauthorized={onUnauthorized}
          active={showChat}
          presentation="focus"
          conversationRefreshKey={refreshKey}
          openHire={hireOpen}
          onHireConsumed={() => setHireOpen(false)}
          onAgentHired={handleAgentHired}
          focusAgentId={selected?.agent_id || focusAgentId}
          focusApprovalRequestId={focusApprovalRequestId}
          onFocusConsumed={onFocusConsumed}
          onApprovalFocusConsumed={onApprovalFocusConsumed}
          onOpenWorkflowRun={onOpenWorkflowRun}
          onOpenGroupChat={onOpenGroupChat}
        />
      </main>
      {hireGroupOpen && (
        <div className="modal-mask" onMouseDown={() => setHireGroupOpen(false)}>
          <div className="modal-card modern-hire-group" onMouseDown={(event) => event.stopPropagation()}>
            <h2>选择员工分组</h2>
            <p className="muted">招聘完成后，新员工会自动进入所选工作组。</p>
            <label>
              工作组
              <select value={hireFolderId} onChange={(event) => setHireFolderId(event.target.value)}>
                <option value="0">未分组</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setHireGroupOpen(false)}>取消</button>
              <button type="button" className="primary" onClick={() => { setHireGroupOpen(false); setHireOpen(true) }}>进入人才市场</button>
            </div>
          </div>
        </div>
      )}
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
