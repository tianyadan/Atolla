import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchAgents,
  fetchInstances,
  hasUnlockToken,
  type PublicInstance,
  type PublicMirrorAgent,
} from '../api'
import { JellyAvatar } from '../jelly/JellyAvatar'
import { jellyStateFromAgent, resolveMirrorJellyColor } from '../jelly/jellyColor'
import { agentBusy, groupAgentsByFolder } from '../utils/agentStatus'
import {
  chatRoute,
  loadInstanceChatSelection,
  rememberChatSelection,
} from '../utils/chatResume'
import { formatPct, isInstanceOnline } from '../utils/instance'
import { loadCollapsedFolders, saveCollapsedFolders } from '../utils/folderCollapse'
import { EngineTag } from './EngineTag'
import { EngineUsageChip } from './EngineUsageChip'
import { IconMonitor } from './InstanceIcons'

type MenuKind = 'agents' | 'instances' | null

type Props = {
  instanceId: string
  agent: PublicMirrorAgent | null
  busy?: boolean
  onOpenAgentSettings?: () => void
}

/** ChatGPT 式轻量聊天导航：左切数字人，中间看状态，右切实例。 */
export function MobileChatHeader({ instanceId, agent, busy, onOpenAgentSettings }: Props) {
  const navigate = useNavigate()
  const [menu, setMenu] = useState<MenuKind>(null)
  const [agents, setAgents] = useState<PublicMirrorAgent[]>([])
  const [instances, setInstances] = useState<PublicInstance[]>([])
  const [loading, setLoading] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => loadCollapsedFolders(instanceId),
  )
  const currentAgentId = agent?.agent_id || ''

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
    if (!menu) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeMenu, menu])

  async function toggleMenu(next: Exclude<MenuKind, null>) {
    if (menu === next) {
      closeMenu()
      return
    }
    // 只允许一个菜单打开，切换时复用同一遮罩。
    setMenu(next)
    setLoading(true)
    setMenuError('')
    try {
      if (next === 'agents') setAgents(await fetchAgents(instanceId))
      else setInstances(await fetchInstances())
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  function openAgent(row: PublicMirrorAgent) {
    rememberChatSelection(instanceId, row.agent_id, row.payload?.conversation_id as string | number)
    closeMenu()
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
      if (row.instance_id === instanceId) closeMenu()
      return
    }
    const iid = row.instance_id
    if (!hasUnlockToken(iid)) {
      closeMenu()
      navigate(`/instances?unlock=${encodeURIComponent(iid)}&resume=1`)
      return
    }
    setLoading(true)
    setMenuError('')
    try {
      const rows = await fetchAgents(iid)
      const saved = loadInstanceChatSelection(iid)
      closeMenu()
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
        closeMenu()
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
  const isWorking = !!(agent && (busy || agentBusy(agent.status)))
  const statusAria = !agent ? '未选择数字人' : isWorking ? '忙碌' : '空闲'

  return (
    <>
      <header className="mobile-chat-nav">
        <button
          type="button"
          className={`mobile-chat-nav-button avatar${menu === 'agents' ? ' is-active' : ''}`}
          aria-label={`切换数字人，${statusAria}`}
          aria-expanded={menu === 'agents'}
          onClick={() => void toggleMenu('agents')}
        >
          {/* 头像 + 右下角状态呼吸灯 */}
          <span className="mobile-chat-avatar-wrap">
            <JellyAvatar
              size={40}
              color={resolveMirrorJellyColor(agent)}
              state={jellyStateFromAgent(agent, { loading: busy, streaming: busy })}
            />
            <i
              className={`mobile-chat-breath is-on-avatar${agent ? (isWorking ? ' is-busy' : ' is-idle') : ' is-offline'}`}
              aria-hidden
            />
          </span>
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

        <button
          type="button"
          className={`mobile-chat-nav-button monitor${menu === 'instances' ? ' is-active' : ''}`}
          aria-label="切换实例"
          aria-expanded={menu === 'instances'}
          onClick={() => void toggleMenu('instances')}
        >
          <IconMonitor size={23} />
        </button>
      </header>

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
