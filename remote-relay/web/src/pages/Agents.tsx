import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clearToken, fetchAgents, type PublicMirrorAgent } from '../api'
import { AgentSettingsSheet } from '../components/AgentSettingsSheet'
import { CreateAgentSheet } from '../components/CreateAgentSheet'
import { EngineTag } from '../components/EngineTag'
import { PageShell } from '../components/PageShell'
import { SettingsIcon } from '../components/SettingsIcon'
import { useUnlockHeartbeat } from '../hooks/useUnlockHeartbeat'
import { JellyAvatar } from '../jelly/JellyAvatar'
import { jellyStateFromAgent, resolveMirrorJellyColor } from '../jelly/jellyColor'
import {
  agentBusy,
  agentRunStartedAt,
  agentStatusLabel,
  countBusyAgents,
  filterAgentGroupsByQuery,
  formatBusyElapsed,
  groupAgentsByFolder,
  agentTaskUnread,
  listBusyAgents,
  listUnreadAgents,
} from '../utils/agentStatus'
import { tapHaptic } from '../haptics'
import { syncIslandFromAgents } from '../islandLiveActivity'
import { loadCollapsedFolders, saveCollapsedFolders } from '../utils/folderCollapse'

const SEARCH_DEBOUNCE_MS = 300

/** Agents mirror grouped by work folder — collapsible + debounced name search */
export function AgentsPage() {
  const { instanceId = '' } = useParams()
  const navigate = useNavigate()
  useUnlockHeartbeat(instanceId || undefined)
  const [agents, setAgents] = useState<PublicMirrorAgent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Collapsed folder keys; empty = all expanded (default); persisted per instance */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsedFolders(instanceId))
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  /** Open agent settings sheet for this agent id */
  const [settingsAgent, setSettingsAgent] = useState<PublicMirrorAgent | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  /** Tick so busy elapsed labels refresh */
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  /** Reload collapse prefs when switching instance */
  useEffect(() => {
    setCollapsed(loadCollapsedFolders(instanceId))
  }, [instanceId])

  /** Persist collapse preference */
  useEffect(() => {
    if (!instanceId) return
    saveCollapsedFolders(instanceId, collapsed)
  }, [instanceId, collapsed])

  /** 1s tick while any agent is busy */
  useEffect(() => {
    if (!agents.some((a) => agentBusy(a.status))) return undefined
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [agents])

  /** Fetch agents list；忙碌态同步到 iPhone 灵动岛 */
  const load = useCallback(async () => {
    if (!instanceId) return
    setError(null)
    try {
      const list = await fetchAgents(instanceId)
      setAgents(list)
      void syncIslandFromAgents(list)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      const status = (err as { status?: number })?.status
      if (msg.includes('Unauthorized') || status === 401) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      if (status === 403 || msg.includes('实例密码')) {
        navigate('/instances', { replace: true })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [instanceId, navigate])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 4_000)
    return () => window.clearInterval(id)
  }, [load])

  /** Debounce search input before filtering */
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const groups = useMemo(() => groupAgentsByFolder(agents), [agents])
  const visibleGroups = useMemo(
    () => filterAgentGroupsByQuery(groups, debouncedQuery),
    [groups, debouncedQuery],
  )
  const hasActiveQuery = debouncedQuery.trim().length > 0
  const busyTotal = useMemo(() => countBusyAgents(agents), [agents])
  /** 搜索框下方「运行中」镜像区（原分组仍保留同一人） */
  const busyVisible = useMemo(
    () => listBusyAgents(agents, debouncedQuery),
    [agents, debouncedQuery],
  )
  /** 系统分类：任务完成未读 */
  const unreadVisible = useMemo(
    () => listUnreadAgents(agents, debouncedQuery),
    [agents, debouncedQuery],
  )
  const hub = `/instances/${encodeURIComponent(instanceId)}`
  const chatBase = `${hub}/agents`

  /** 渲染单个数字人卡片（运行中 / 未读区与分组列表共用） */
  function renderAgentCard(a: PublicMirrorAgent) {
    const isBusy = agentBusy(a.status)
    const isUnread = !isBusy && agentTaskUnread(a.payload)
    const elapsed = isBusy ? formatBusyElapsed(agentRunStartedAt(a.payload), nowSec) : ''
    return (
      <li key={a.agent_id} className="list-item agent-card">
        <div className="agent-card-row">
          <button
            type="button"
            className="agent-card-btn"
            onClick={() => {
              tapHaptic()
              // 乐观清未读：与 PC 选中即消徽标一致，不依赖 Mac 命令往返
              if (agentTaskUnread(a.payload)) {
                setAgents((list) =>
                  list.map((row) =>
                    row.agent_id === a.agent_id
                      ? {
                          ...row,
                          payload: {
                            ...row.payload,
                            task_unread: false,
                            task_unread_kind: '',
                            task_unread_at: null,
                            task_unread_duration_ms: 0,
                            task_unread_summary: '',
                          },
                        }
                      : row,
                  ),
                )
              }
              navigate(`${chatBase}/${encodeURIComponent(a.agent_id)}/chat`)
            }}
          >
            <JellyAvatar
              className="agent-avatar"
              color={resolveMirrorJellyColor(a)}
              size={40}
              state={jellyStateFromAgent(a)}
            />
            <div className="agent-card-meta">
              <div className="list-title">
                {a.display_name || a.agent_id}
                {isUnread ? (
                  <span className="unread-dot-badge" title="任务完成未读" aria-label="未读" />
                ) : null}
              </div>
              <div className="list-sub agent-card-sub">
                <span className={`status-pill ${isBusy ? 'busy' : isUnread ? 'unread' : 'idle'}`}>
                  {isUnread ? '未读' : agentStatusLabel(a.status)}
                </span>
                <EngineTag engine={a.engine} />
                {elapsed ? (
                  <span className="agent-busy-elapsed muted" title="任务已运行">
                    {elapsed}
                  </span>
                ) : null}
              </div>
            </div>
          </button>
          <button
            type="button"
            className="icon-btn agent-settings-btn"
            aria-label={`设置 ${a.display_name || a.agent_id}`}
            onClick={(e) => {
              e.stopPropagation()
              setSettingsAgent(a)
            }}
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </li>
    )
  }

  /** Toggle one folder open/closed */
  function toggleFolder(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Collapse every visible folder */
  function collapseAll() {
    setCollapsed(new Set(groups.map((g) => g.key)))
  }

  /** Expand every folder */
  function expandAll() {
    setCollapsed(new Set())
  }

  /** Close search bar and clear query */
  function closeSearch() {
    setSearchOpen(false)
    setSearchInput('')
    setDebouncedQuery('')
  }

  const headerRight = searchOpen ? (
    <div className="agent-search-bar">
      <input
        className="agent-search-input"
        type="search"
        autoFocus
        placeholder="搜索数字人"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        aria-label="搜索数字人"
      />
      <button type="button" className="icon-btn" onClick={closeSearch} aria-label="关闭搜索">
        ✕
      </button>
    </div>
  ) : (
    <div className="agent-header-actions">
      <button
        type="button"
        className="icon-btn"
        onClick={() => setCreateOpen(true)}
        aria-label="创建数字员工"
      >
        ＋
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setSearchOpen(true)}
        aria-label="搜索数字人"
      >
        ⌕
      </button>
    </div>
  )

  return (
    <PageShell title="数字员工" backTo={hub} right={headerRight}>
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && agents.length === 0 ? (
        <div className="agent-empty">
          <p className="muted">暂无数字员工，点击右上角 ＋ 创建</p>
          <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
            创建数字员工
          </button>
        </div>
      ) : null}
      {!loading && agents.length > 0 ? (
        <div className="agent-fold-toolbar">
          <button type="button" className="btn outline small" onClick={expandAll}>
            全部展开
          </button>
          <button type="button" className="btn outline small" onClick={collapseAll}>
            全部折叠
          </button>
          {busyTotal > 0 ? (
            <span className="busy-count-badge" title={`忙碌中 ${busyTotal}`}>
              {busyTotal}
            </span>
          ) : null}
        </div>
      ) : null}
      {!loading && agents.length > 0 && hasActiveQuery && visibleGroups.length === 0 ? (
        <p className="muted">无匹配数字人</p>
      ) : null}
      {/* 未读优先于运行中，置顶；小蓝呼吸灯标识 */}
      {!loading && unreadVisible.length > 0 ? (
        <section className="agent-folder agent-unread-block">
          <div className="agent-folder-toggle" aria-hidden>
            <span className="unread-breath-dot" title="有未读" aria-hidden />
            <span className="agent-folder-title">未读</span>
            <span className="unread-count-badge folder-unread-badge" title={`未读 ${unreadVisible.length}`}>
              {unreadVisible.length}
            </span>
          </div>
          <ul className="list">{unreadVisible.map(renderAgentCard)}</ul>
        </section>
      ) : null}
      {!loading && busyVisible.length > 0 ? (
        <section className="agent-folder agent-running-block">
          <div className="agent-folder-toggle" aria-hidden>
            <span className="agent-folder-title">运行中</span>
            <span className="busy-count-badge folder-busy-badge" title={`运行中 ${busyVisible.length}`}>
              {busyVisible.length}
            </span>
          </div>
          <ul className="list">{busyVisible.map(renderAgentCard)}</ul>
        </section>
      ) : null}
      {visibleGroups.map((g) => {
        const open = hasActiveQuery || !collapsed.has(g.key)
        const groupBusy = g.agents.filter((a) => agentBusy(a.status)).length
        return (
          <section key={g.key} className={`agent-folder${open ? '' : ' is-collapsed'}`}>
            <button
              type="button"
              className="agent-folder-toggle"
              onClick={() => toggleFolder(g.key)}
              aria-expanded={open}
            >
              <span className={`agent-folder-chevron${open ? ' open' : ''}`} aria-hidden>
                ▸
              </span>
              <span className="agent-folder-title">{g.title}</span>
              {groupBusy > 0 ? (
                <span className="busy-count-badge folder-busy-badge" title={`忙碌中 ${groupBusy}`}>
                  {groupBusy}
                </span>
              ) : null}
              <span className="agent-folder-count muted">{g.agents.length}</span>
            </button>
            {open ? <ul className="list">{g.agents.map(renderAgentCard)}</ul> : null}
          </section>
        )
      })}

      <AgentSettingsSheet
        open={!!settingsAgent}
        instanceId={instanceId}
        agentId={settingsAgent?.agent_id ?? ''}
        agentName={settingsAgent?.display_name ?? undefined}
        onClose={() => setSettingsAgent(null)}
      />
      <CreateAgentSheet
        open={createOpen}
        instanceId={instanceId}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          void load()
          navigate(`${chatBase}/${encodeURIComponent(id)}/chat`)
        }}
      />
    </PageShell>
  )
}
