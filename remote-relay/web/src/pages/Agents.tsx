import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clearToken, fetchAgents, type PublicMirrorAgent } from '../api'
import { PageShell } from '../components/PageShell'
import {
  agentAvatarUrl,
  agentBusy,
  agentStatusLabel,
  countBusyAgents,
  filterAgentGroupsByQuery,
  groupAgentsByFolder,
} from '../utils/agentStatus'
import { loadCollapsedFolders, saveCollapsedFolders } from '../utils/folderCollapse'

const SEARCH_DEBOUNCE_MS = 300

/** Agents mirror grouped by work folder — collapsible + debounced name search */
export function AgentsPage() {
  const { instanceId = '' } = useParams()
  const navigate = useNavigate()
  const [agents, setAgents] = useState<PublicMirrorAgent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Collapsed folder keys; empty = all expanded (default); persisted per instance */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsedFolders(instanceId))
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  /** Reload collapse prefs when switching instance */
  useEffect(() => {
    setCollapsed(loadCollapsedFolders(instanceId))
  }, [instanceId])

  /** Persist collapse preference */
  useEffect(() => {
    if (!instanceId) return
    saveCollapsedFolders(instanceId, collapsed)
  }, [instanceId, collapsed])

  /** Fetch agents list */
  const load = useCallback(async () => {
    if (!instanceId) return
    setError(null)
    try {
      setAgents(await fetchAgents(instanceId))
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
    const id = window.setInterval(() => void load(), 15_000)
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
  const hub = `/instances/${encodeURIComponent(instanceId)}`
  const chatBase = `${hub}/agents`

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
    <button
      type="button"
      className="icon-btn"
      onClick={() => setSearchOpen(true)}
      aria-label="搜索数字人"
    >
      ⌕
    </button>
  )

  return (
    <PageShell title="数字员工" backTo={hub} right={headerRight}>
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && agents.length === 0 ? <p className="muted">暂无数字人数据</p> : null}
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
      {visibleGroups.map((g) => {
        // While searching, force-expand so matches are always visible
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
            {open ? (
              <ul className="list">
                {g.agents.map((a) => (
                  <li key={a.agent_id} className="list-item agent-card">
                    <button
                      type="button"
                      className="agent-card-btn"
                      onClick={() =>
                        navigate(`${chatBase}/${encodeURIComponent(a.agent_id)}/chat`)
                      }
                    >
                      <img
                        className="agent-avatar"
                        src={agentAvatarUrl(a.payload)}
                        alt=""
                      />
                      <div className="agent-card-meta">
                        <div className="list-title">{a.display_name || a.agent_id}</div>
                        <div className="list-sub">
                          <span
                            className={`status-pill ${
                              agentStatusLabel(a.status) === '忙碌中' ? 'busy' : 'idle'
                            }`}
                          >
                            {agentStatusLabel(a.status)}
                          </span>
                          {a.engine ? <span className="muted"> · {a.engine}</span> : null}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
    </PageShell>
  )
}
