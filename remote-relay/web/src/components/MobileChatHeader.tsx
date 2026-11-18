import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchAgents,
  fetchEnginesUsage,
  fetchInstances,
  fetchReceiveEmail,
  hasUnlockToken,
  type PublicInstance,
  type PublicMirrorAgent,
} from '../api'
import { JellyAvatar } from '../jelly/JellyAvatar'
import { jellyStateFromAgent, resolveMirrorJellyColor } from '../jelly/jellyColor'
import {
  agentBusy,
  groupAgentsByFolder,
} from '../utils/agentStatus'
import {
  chatRoute,
  loadInstanceChatSelection,
  rememberChatSelection,
} from '../utils/chatResume'
import {
  DRAWER_USAGE_TTL_MS,
  drawerQuotaLabel,
  drawerQuotaTitle,
  engineRemainingPct,
  enginesUsageCacheFresh,
  isUnlimitedEngine,
  peekEnginesUsageCache,
  rememberEnginesUsage,
  usageEngineId,
  type EnginesUsageResponse,
  type EngineUsageRow,
} from '../utils/engineUsage'
import { formatPct, isInstanceOnline } from '../utils/instance'
import { hasLanInstanceAccess } from '../utils/connectionSession'
import { loadCollapsedFolders, saveCollapsedFolders } from '../utils/folderCollapse'
import { rememberSettingsBack } from '../utils/settingsNav'
import { EngineTag } from './EngineTag'
import { EngineUsageChip } from './EngineUsageChip'
import {
  IconChevronDown,
  IconChevronRight,
  IconMonitor,
  IconSidebar,
  IconUser,
  IconUsers,
} from './InstanceIcons'
import { Popover } from './Popover'
import { SettingsIcon } from './SettingsIcon'

type MenuKind = 'agents' | 'instances' | null

type Props = {
  instanceId: string
  agent: PublicMirrorAgent | null
  busy?: boolean
  onOpenAgentSettings?: () => void
}

const ACTIVE_PLAN_PHASES = new Set(['planning', 'awaiting_confirm', 'running', 'paused'])

/** Active task-plan progress from mirror payload (0–100), or null if none */
function agentTaskPlanProgress(payload: Record<string, unknown> | undefined): number | null {
  const plan = payload?.task_plan
  if (!plan || typeof plan !== 'object') return null
  const row = plan as Record<string, unknown>
  const phase = String(row.phase || '').toLowerCase()
  if (phase && !ACTIVE_PLAN_PHASES.has(phase)) return null
  const progress = Math.max(0, Math.min(100, Math.round(Number(row.progress) || 0)))
  const totalCount = Math.max(0, Math.round(Number(row.total_count) || 0))
  const message = String(row.message || '').trim()
  if (
    totalCount <= 0 &&
    progress <= 0 &&
    !message &&
    phase !== 'planning' &&
    phase !== 'awaiting_confirm'
  ) {
    return null
  }
  if ((phase === 'planning' || phase === 'awaiting_confirm') && progress < 2) return 2
  return progress
}

/** ChatGPT 式轻量聊天导航：左切数字人，中间看状态，右切实例。 */
export function MobileChatHeader({
  instanceId,
  agent,
  onOpenAgentSettings,
}: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerInstance, setDrawerInstance] = useState<PublicInstance | null>(null)
  const [drawerAccountHint, setDrawerAccountHint] = useState('账号信息')
  const [instancesLoading, setInstancesLoading] = useState(false)
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [agentsError, setAgentsError] = useState('')
  const [enginesUsage, setEnginesUsage] = useState<EnginesUsageResponse | null>(() =>
    peekEnginesUsageCache(instanceId),
  )
  const [instancePopoverOpen, setInstancePopoverOpen] = useState(false)
  const instanceAnchorRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<MenuKind>(null)
  const [agents, setAgents] = useState<PublicMirrorAgent[]>([])
  const [instances, setInstances] = useState<PublicInstance[]>([])
  const [loading, setLoading] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => loadCollapsedFolders(instanceId),
  )
  const currentAgentId = agent?.agent_id || ''

  /** Lookup cached engine usage row for an agent */
  function usageRowFor(engine: string | null | undefined): EngineUsageRow | null {
    const id = usageEngineId(engine)
    return enginesUsage?.engines?.find((row) => row.id === id) ?? null
  }

  /** Online instances only for the drawer popover switcher */
  const onlineInstances = useMemo(
    () => instances.filter((row) => isInstanceOnline(row.last_heartbeat_at)),
    [instances],
  )

  /** Open / close the left nav drawer */
  function openDrawer() {
    setMenu(null)
    setInstancePopoverOpen(false)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setInstancePopoverOpen(false)
    setDrawerOpen(false)
  }

  /** Jump to existing agents management page for this instance */
  function openAgentManage() {
    closeDrawer()
    navigate(`/instances/${encodeURIComponent(instanceId)}/agents`)
  }

  /** Jump to global settings; back should reopen this drawer on the same chat */
  function openSettings() {
    const returnPath = `${window.location.pathname}?drawer=1`
    rememberSettingsBack(returnPath)
    closeDrawer()
    navigate('/settings')
  }

  /** Re-open drawer when returning from Settings (?drawer=1) */
  useEffect(() => {
    if (searchParams.get('drawer') !== '1') return
    setDrawerOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('drawer')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  /** Lock page scroll while the overlay drawer is open */
  useEffect(() => {
    if (!drawerOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  /**
   * Each drawer region owns its own request. Engine usage or the optional
   * remote account profile must never hide the paired Mac or its agents.
   */
  useEffect(() => {
    if (!drawerOpen || !instanceId) return undefined
    let cancelled = false
    setInstancesLoading(true)
    void fetchInstances()
      .then((rows) => {
        if (cancelled) return
        setInstances(rows)
        setDrawerInstance(rows.find((row) => row.instance_id === instanceId) || null)
      })
      .catch(() => {
        if (!cancelled) {
          setInstances([])
          setDrawerInstance(null)
        }
      })
      .finally(() => { if (!cancelled) setInstancesLoading(false) })
    return () => {
      cancelled = true
    }
  }, [drawerOpen, instanceId])

  useEffect(() => {
    if (!drawerOpen || !instanceId) return undefined
    let cancelled = false
    setAgentsLoading(true)
    setAgentsError('')
    void fetchAgents(instanceId)
      .then((rows) => { if (!cancelled) setAgents(rows) })
      .catch((error) => { if (!cancelled) setAgentsError(error instanceof Error ? error.message : '数字人加载失败') })
      .finally(() => { if (!cancelled) setAgentsLoading(false) })
    return () => { cancelled = true }
  }, [drawerOpen, instanceId])

  useEffect(() => {
    if (!drawerOpen) return
    let cancelled = false
    void fetchReceiveEmail()
      .then((receive) => {
        if (cancelled) return
        const email = String(receive?.email_masked || receive?.email || '').trim()
        setDrawerAccountHint(email || '账号信息')
      })
      .catch(() => { if (!cancelled) setDrawerAccountHint('账号信息') })
    return () => { cancelled = true }
  }, [drawerOpen])

  useEffect(() => {
    if (!drawerOpen || !instanceId) return
    let cancelled = false
    // 切换云端/LAN 实例时先清掉其他 Mac 的旧额度，再请求当前实例。
    setEnginesUsage(peekEnginesUsageCache(instanceId))
    void (async () => {
      if (enginesUsageCacheFresh(DRAWER_USAGE_TTL_MS, instanceId)) {
        return peekEnginesUsageCache(instanceId)
      }
      try {
        return rememberEnginesUsage(await fetchEnginesUsage(instanceId, { fresh: true }), { instanceId })
      } catch {
        // LAN 请求失败时只允许回退同一台 Mac 的旧值，禁止误展示云端实例额度。
        return peekEnginesUsageCache(instanceId)
      }
    })().then((usage) => { if (!cancelled && usage) setEnginesUsage(usage) })
    return () => { cancelled = true }
  }, [drawerOpen, instanceId])

  /** Keep collapse prefs in sync when switching instance */
  useEffect(() => {
    setCollapsedGroups(loadCollapsedFolders(instanceId))
  }, [instanceId])

  /** 防止镜像接口偶发重复行造成同一数字人在菜单出现两次。 */
  const uniqueAgents = useMemo(() => {
    const rows = new Map<string, PublicMirrorAgent>()
    for (const row of agents) {
      const previous = rows.get(row.agent_id)
      if (!previous || row.synced_at >= previous.synced_at) rows.set(row.agent_id, row)
    }
    return [...rows.values()]
  }, [agents])
  const agentGroups = useMemo(() => groupAgentsByFolder(uniqueAgents), [uniqueAgents])

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!menu && !drawerOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (drawerOpen) closeDrawer()
      else closeMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeMenu, drawerOpen, menu])

  function openAgent(row: PublicMirrorAgent) {
    rememberChatSelection(instanceId, row.agent_id, row.payload?.conversation_id as string | number)
    closeMenu()
    closeDrawer()
    navigate(chatRoute({ instanceId, agentId: row.agent_id }))
  }

  function toggleAgentGroup(groupKey: string) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      saveCollapsedFolders(instanceId, next)
      return next
    })
  }

  async function openInstance(row: PublicInstance) {
    if (!isInstanceOnline(row.last_heartbeat_at) || row.instance_id === instanceId) {
      if (row.instance_id === instanceId) {
        setInstancePopoverOpen(false)
        closeMenu()
      }
      return
    }
    const iid = row.instance_id
    if (!hasUnlockToken(iid) && !hasLanInstanceAccess(iid)) {
      setInstancePopoverOpen(false)
      closeMenu()
      closeDrawer()
      navigate(`/instances?unlock=${encodeURIComponent(iid)}&resume=1`)
      return
    }
    setLoading(true)
    setMenuError('')
    try {
      const rows = await fetchAgents(iid)
      const saved = loadInstanceChatSelection(iid)
      setInstancePopoverOpen(false)
      closeMenu()
      closeDrawer()
      const selected = saved && rows.find((item) => item.agent_id === saved.agentId)
      if (selected) {
        rememberChatSelection(
          iid,
          selected.agent_id,
          selected.payload?.conversation_id as string | number,
        )
        navigate(chatRoute({ instanceId: iid, agentId: selected.agent_id }))
        return
      }
      // 首次使用该实例或原数字人失效时，让用户明确选择，不按同步时间猜测。
      navigate(`/instances/${encodeURIComponent(iid)}/start`)
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 403) {
        setInstancePopoverOpen(false)
        closeMenu()
        closeDrawer()
        navigate(`/instances?unlock=${encodeURIComponent(iid)}&resume=1`)
        return
      }
      setMenuError(err instanceof Error ? err.message : '切换实例失败')
    } finally {
      setLoading(false)
    }
  }

  const title = agent?.display_name || agent?.agent_id || '数字人'
  const currentGroup = String(agent?.payload?.folder_name || '').trim() || '未入组'
  const instanceOnline = !!(drawerInstance && isInstanceOnline(drawerInstance.last_heartbeat_at))
  const currentUsesLan = drawerInstance?.connection === 'lan'
  const currentConnectionLabel = instanceOnline
    ? currentUsesLan ? '局域网连接' : '服务器连接'
    : '离线 · 当前实例'

  return (
    <>
      <header className="mobile-chat-nav is-no-trailing">
        <button
          type="button"
          className={`mobile-chat-nav-button drawer-toggle${drawerOpen ? ' is-active' : ''}`}
          aria-label="打开导航抽屉"
          aria-expanded={drawerOpen}
          onClick={openDrawer}
        >
          <IconSidebar size={22} />
        </button>

        <div className="mobile-chat-nav-center">
          <button
            type="button"
            className="mobile-chat-nav-title"
            aria-label={agent ? '查看数字人详情' : '尚未选择数字人'}
            disabled={!agent}
            onClick={() => agent && onOpenAgentSettings?.()}
          >
            {/* 第一行：数字人名称；第二行：引擎 + 组名 */}
            <strong className="mobile-chat-agent-name">{title}</strong>
            {agent ? (
              <span className="mobile-chat-meta-row">
                <EngineTag engine={agent.engine} />
                <span className="mobile-chat-agent-group">{currentGroup}</span>
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {drawerOpen ? (
        <div className="mobile-nav-drawer-mask" onClick={closeDrawer} aria-hidden={false}>
          <aside
            className="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="导航抽屉"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Overlay layout zones — content wired in later steps */}
            <div className="mobile-nav-drawer-inner">
              <header className="mobile-nav-drawer-brand">
                <span className="mobile-nav-drawer-brand-mark" aria-hidden>
                  <img
                    className="mobile-nav-drawer-brand-logo is-light"
                    src="/brand-jellyfish.png"
                    alt=""
                    width={22}
                    height={22}
                    draggable={false}
                  />
                  <img
                    className="mobile-nav-drawer-brand-logo is-dark"
                    src="/brand-jellyfish-white.png"
                    alt=""
                    width={22}
                    height={22}
                    draggable={false}
                  />
                </span>
                <strong className="mobile-nav-drawer-brand-name">Atolla</strong>
              </header>

              <div className="mobile-nav-drawer-scroll">
                <section className="mobile-nav-drawer-block is-plain" aria-label="当前实例">
                  <button
                    ref={instanceAnchorRef}
                    type="button"
                    className={`mobile-nav-drawer-instance is-button${instancePopoverOpen ? ' is-open' : ''}`}
                    aria-haspopup="dialog"
                    aria-expanded={instancePopoverOpen}
                    onClick={() => setInstancePopoverOpen((v) => !v)}
                  >
                    <span className="mobile-nav-drawer-instance-icon" aria-hidden>
                      <IconMonitor size={20} />
                    </span>
                    <span className="mobile-nav-drawer-instance-copy">
                      <strong>
                        {drawerInstance?.display_name || drawerInstance?.instance_id || instanceId}
                      </strong>
                      <small>
                        <i className={instanceOnline ? currentUsesLan ? 'is-lan' : 'is-idle' : 'is-offline'} aria-hidden />
                        <span className={instanceOnline && currentUsesLan ? 'is-lan-text' : ''}>{currentConnectionLabel}</span>
                      </small>
                    </span>
                    <span className="mobile-nav-drawer-instance-caret" aria-hidden>
                      <IconChevronDown size={16} />
                    </span>
                  </button>
                  <Popover
                    open={instancePopoverOpen}
                    onClose={() => setInstancePopoverOpen(false)}
                    anchorRef={instanceAnchorRef}
                    className="mobile-nav-instance-popover"
                    placement="bottom-start"
                  >
                    <div className="mobile-nav-instance-popover-head">在线电脑</div>
                    {instancesLoading ? (
                      <p className="mobile-nav-instance-popover-empty">正在加载实例…</p>
                    ) : onlineInstances.length === 0 ? (
                      <p className="mobile-nav-instance-popover-empty">暂无在线实例</p>
                    ) : (
                      <ul className="mobile-nav-instance-popover-list">
                        {onlineInstances.map((row) => {
                          const selected = row.instance_id === instanceId
                          return (
                            <li key={row.instance_id}>
                              <button
                                type="button"
                                className={`mobile-nav-instance-option${selected ? ' is-selected' : ''}`}
                                disabled={loading}
                                onClick={() => void openInstance(row)}
                              >
                                <span className="mobile-nav-drawer-instance-icon" aria-hidden>
                                  <IconMonitor size={18} />
                                </span>
                                <span className="mobile-nav-drawer-instance-copy">
                                  <strong>{row.display_name || row.instance_id}</strong>
                                  <small>
                                    <i className={row.connection === 'lan' ? 'is-lan' : 'is-idle'} aria-hidden />
                                    <span className={row.connection === 'lan' ? 'is-lan-text' : ''}>
                                      {row.connection === 'lan' ? '局域网连接' : '服务器连接'}{selected ? ' · 当前实例' : ''}
                                    </span>
                                  </small>
                                </span>
                                {selected ? <span className="mobile-nav-instance-check" aria-hidden>✓</span> : null}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </Popover>
                </section>

                <section className="mobile-nav-drawer-block is-plain" aria-label="数字人管理">
                  <button
                    type="button"
                    className="mobile-nav-drawer-link"
                    onClick={openAgentManage}
                  >
                    <span className="mobile-nav-drawer-link-icon" aria-hidden>
                      <IconUsers size={18} />
                    </span>
                    <span className="mobile-nav-drawer-link-label">数字人管理</span>
                    <IconChevronRight size={16} />
                  </button>
                </section>

                <section className="mobile-nav-drawer-block is-plain is-grow" aria-label="数字人分组">
                  <div className="mobile-nav-drawer-groups">
                    {agentsLoading ? <p className="mobile-nav-drawer-hint">正在加载数字人…</p> : null}
                    {agentsError ? <p className="mobile-nav-drawer-error">{agentsError}</p> : null}
                    {!agentsLoading && !agentsError && agentGroups.length === 0 ? (
                      <p className="mobile-nav-drawer-hint">当前实例暂无数字人</p>
                    ) : null}
                    {!agentsLoading
                      ? agentGroups.map((group) => {
                          const open = !collapsedGroups.has(group.key)
                          return (
                            <section className="mobile-nav-drawer-group" key={group.key}>
                              <button
                                type="button"
                                className="mobile-nav-drawer-group-toggle"
                                aria-expanded={open}
                                onClick={() => toggleAgentGroup(group.key)}
                              >
                                <span
                                  className={`mobile-nav-drawer-group-chevron${open ? ' is-open' : ''}`}
                                  aria-hidden
                                >
                                  <IconChevronDown size={14} />
                                </span>
                                <span className="mobile-nav-drawer-group-title">{group.title}</span>
                                <small>{group.agents.length}</small>
                              </button>
                              {open ? (
                                <div className="mobile-nav-drawer-group-items">
                                  {group.agents.map((row) => {
                                    const selected = row.agent_id === currentAgentId
                                    const working = agentBusy(row.status)
                                    const planPct = agentTaskPlanProgress(row.payload)
                                    const usageRow = usageRowFor(row.engine)
                                    const unlimited = isUnlimitedEngine(row.engine)
                                    const remainPct = unlimited
                                      ? null
                                      : engineRemainingPct(row.engine, usageRow)
                                    const quotaLabel = drawerQuotaLabel(row.engine, usageRow)
                                    const quotaTitle = drawerQuotaTitle(row.engine, usageRow)
                                    const statusText = working ? '运行中' : '空闲'
                                    return (
                                      <button
                                        type="button"
                                        key={row.agent_id}
                                        className={`mobile-nav-drawer-agent${selected ? ' is-selected' : ''}`}
                                        aria-label={`${row.display_name || row.agent_id}，${statusText}`}
                                        onClick={() => openAgent(row)}
                                      >
                                        <span className="mobile-nav-drawer-agent-avatar">
                                          <JellyAvatar
                                            size={36}
                                            color={resolveMirrorJellyColor(row)}
                                            state={jellyStateFromAgent(row)}
                                          />
                                        </span>
                                        <span className="mobile-nav-drawer-agent-copy">
                                          <strong>{row.display_name || row.agent_id}</strong>
                                          <small>
                                            <i
                                              className={working ? 'is-busy' : 'is-idle'}
                                              aria-hidden
                                            />
                                            {statusText}
                                            {planPct != null ? ` · ${planPct}%` : ''}
                                          </small>
                                        </span>
                                        {unlimited ? (
                                          <span
                                            className="mobile-nav-drawer-quota is-unlimited"
                                            title={quotaTitle}
                                          >
                                            <em className="mobile-nav-drawer-quota-inf">∞</em>
                                          </span>
                                        ) : remainPct != null ? (
                                          <span
                                            className="mobile-nav-drawer-token"
                                            title={quotaTitle}
                                          >
                                            <span className="mobile-nav-drawer-token-bar" aria-hidden>
                                              <span style={{ width: `${remainPct}%` }} />
                                            </span>
                                            <em>{quotaLabel}</em>
                                          </span>
                                        ) : null}
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </section>
                          )
                        })
                      : null}
                  </div>
                </section>
              </div>

              <footer className="mobile-nav-drawer-foot" aria-label="账号与设置">
                <div className="mobile-nav-drawer-user">
                  <span className="mobile-nav-drawer-user-avatar" aria-hidden>
                    <IconUser size={20} />
                  </span>
                  <span className="mobile-nav-drawer-user-copy">
                    <strong>当前登录用户</strong>
                    <small>{drawerAccountHint}</small>
                  </span>
                  <button
                    type="button"
                    className="mobile-nav-drawer-settings"
                    aria-label="设置"
                    title="设置"
                    onClick={openSettings}
                  >
                    <SettingsIcon size={20} />
                  </button>
                </div>
              </footer>
            </div>
          </aside>
        </div>
      ) : null}

      {menu ? (
        <div className="mobile-switcher-backdrop" onClick={closeMenu}>
          <section
            className={`mobile-switcher-panel is-${menu}`}
            role="dialog"
            aria-modal="true"
            aria-label={menu === 'agents' ? '数字人' : '实例'}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2>{menu === 'agents' ? '数字人' : '实例'}</h2>
              <button
                type="button"
                onClick={() => {
                  closeMenu()
                  navigate(
                    menu === 'agents'
                      ? `/instances/${encodeURIComponent(instanceId)}/agents`
                      : '/instances',
                  )
                }}
              >
                管理
              </button>
            </header>

            {/* 当前数字人引擎用量：从对话顶栏挪到此，避免挤占标题区 */}
            {menu === 'agents' && agent ? (
              <div className="mobile-switcher-usage">
                <span className="mobile-switcher-usage-label">
                  当前 · {agent.display_name || agent.agent_id}
                </span>
                <div className="mobile-switcher-usage-row">
                  <EngineTag engine={agent.engine} />
                  <EngineUsageChip instanceId={instanceId} engine={agent.engine} />
                </div>
              </div>
            ) : null}

            <div className="mobile-switcher-list">
              {loading ? <p className="mobile-switcher-hint">加载中…</p> : null}
              {menuError ? <p className="mobile-switcher-error">{menuError}</p> : null}

              {!loading && menu === 'agents'
                ? agentGroups.map((group) => {
                    const open = !collapsedGroups.has(group.key)
                    return (
                      <section className="mobile-agent-group-section" key={group.key}>
                        <button
                          type="button"
                          className="mobile-agent-group-toggle"
                          aria-expanded={open}
                          onClick={() => toggleAgentGroup(group.key)}
                        >
                          <span
                            className={`mobile-agent-group-chevron${open ? ' is-open' : ''}`}
                            aria-hidden
                          >
                            ›
                          </span>
                          <span>{group.title}</span>
                          <small>{group.agents.length}</small>
                        </button>
                        {open ? (
                          <div className="mobile-agent-group-items">
                            {group.agents.map((row) => {
                              const selected = row.agent_id === currentAgentId
                              const working = agentBusy(row.status)
                              return (
                                <button
                                  type="button"
                                  className={`mobile-agent-option${selected ? ' is-selected' : ''}`}
                                  key={row.agent_id}
                                  aria-label={`${row.display_name || row.agent_id}，${working ? '忙碌' : '空闲'}`}
                                  onClick={() => openAgent(row)}
                                >
                                  {/* 状态只保留头像右下角呼吸灯，不再跟文字 */}
                                  <span className="mobile-chat-avatar-wrap">
                                    <JellyAvatar
                                      size={42}
                                      color={resolveMirrorJellyColor(row)}
                                      state={jellyStateFromAgent(row)}
                                    />
                                    <i
                                      className={`mobile-chat-breath is-on-avatar${working ? ' is-busy' : ' is-idle'}`}
                                      aria-hidden
                                    />
                                  </span>
                                  <span className="mobile-option-copy">
                                    <strong>{row.display_name || row.agent_id}</strong>
                                  </span>
                                  <span className="mobile-option-check" aria-hidden>
                                    {selected ? '✓' : ''}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </section>
                    )
                  })
                : null}

              {!loading && menu === 'instances'
                ? instances.map((row) => {
                    const online = isInstanceOnline(row.last_heartbeat_at)
                    const selected = row.instance_id === instanceId
                    return (
                      <button
                        type="button"
                        className={`mobile-instance-option${selected ? ' is-selected' : ''}`}
                        key={row.instance_id}
                        disabled={!online}
                        onClick={() => void openInstance(row)}
                      >
                        <span className="mobile-instance-icon"><IconMonitor size={22} /></span>
                        <span className="mobile-option-copy">
                          <strong>{row.display_name || row.instance_id}</strong>
                          <small>
                            <i className={online ? 'is-idle' : 'is-offline'} aria-hidden />
                            {online ? '在线' : '离线'} · {row.host?.os || '未知系统'}
                          </small>
                          <span className="mobile-instance-metrics">
                            CPU {formatPct(row.host?.cpu_pct)}% · 内存 {formatPct(row.host?.mem_pct)}% · 磁盘 {formatPct(row.host?.disk_pct)}%
                          </span>
                        </span>
                        <span className="mobile-option-check" aria-hidden>{selected ? '✓' : ''}</span>
                      </button>
                    )
                  })
                : null}

              {!loading && !menuError && menu === 'agents' && uniqueAgents.length === 0 ? (
                <p className="mobile-switcher-hint">当前实例暂无数字人</p>
              ) : null}
              {!loading && !menuError && menu === 'instances' && instances.length === 0 ? (
                <p className="mobile-switcher-hint">暂无实例</p>
              ) : null}
            </div>

            <button
              type="button"
              className="mobile-switcher-manage"
              onClick={() => {
                closeMenu()
                navigate(
                  menu === 'agents'
                    ? `/instances/${encodeURIComponent(instanceId)}/agents`
                    : '/instances',
                )
              }}
            >
              {menu === 'agents' ? '管理数字人' : '管理实例'}
              <span aria-hidden>›</span>
            </button>
          </section>
        </div>
      ) : null}
    </>
  )
}
