import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  clearToken,
  fetchInstances,
  hasUnlockToken,
  revokeInstancePassword,
  unlockInstance,
  type PublicInstance,
} from '../api'
import {
  IconChevronRight,
  IconChip,
  IconClock,
  IconDisk,
  IconEnter,
  IconInfo,
  IconMemory,
  IconMonitor,
  IconMore,
  IconMoon,
  IconSearch,
  IconSun,
  IconTemp,
  IconTrash,
} from '../components/InstanceIcons'
import { Modal } from '../components/Modal'
import { SettingsIcon } from '../components/SettingsIcon'
import { tapHaptic } from '../haptics'
import { getStoredTheme, toggleTheme, type ThemeMode } from '../utils/theme'
import {
  loadPendingDeepLink,
  navigateToDeepLinkChat,
} from '../utils/deepLink'
import {
  formatPct,
  formatTempC,
  formatUptime,
  isInstanceOnline,
  tempBarPct,
} from '../utils/instance'

type StatusFilter = 'online' | 'offline'

/** Dark instances management — matches prototype, wired to real APIs */
export function InstancesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const unlockTargetId = searchParams.get('unlock') || ''
  const [items, setItems] = useState<PublicInstance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  /** 底部胶囊：默认看在线实例 */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('online')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [detailTarget, setDetailTarget] = useState<PublicInstance | null>(null)

  const [enterTarget, setEnterTarget] = useState<PublicInstance | null>(null)
  const [enterPassword, setEnterPassword] = useState('')
  const [enterError, setEnterError] = useState<string | null>(null)
  const [enterBusy, setEnterBusy] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<PublicInstance | null>(null)

  /** Load instance list from API */
  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await fetchInstances())
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      if (msg.includes('Unauthorized') || msg.includes('401')) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    void load()
    const tick = window.setInterval(() => setNow(Date.now()), 10_000)
    const refresh = window.setInterval(() => void load(), 15_000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(refresh)
    }
  }, [load])

  /** 灵动岛深链恢复：实例存在则直达或自动打开密码框。 */
  useEffect(() => {
    if (loading || !unlockTargetId) return
    const target = loadPendingDeepLink()
    if (!target || target.instanceId !== unlockTargetId) return
    const instance = items.find((item) => item.instance_id === unlockTargetId)
    if (!instance) {
      setError('目标实例不存在或已被移除')
      return
    }
    if (hasUnlockToken(unlockTargetId)) {
      navigateToDeepLinkChat(navigate, target, {
        pathname: window.location.pathname,
        search: window.location.search,
      })
      return
    }
    if (enterTarget?.instance_id !== instance.instance_id) {
      setEnterTarget(instance)
      setEnterPassword('')
      setEnterError(null)
    }
  }, [enterTarget?.instance_id, items, loading, navigate, unlockTargetId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((inst) => {
      const online = isInstanceOnline(inst.last_heartbeat_at, now)
      if (statusFilter === 'online' && !online) return false
      if (statusFilter === 'offline' && online) return false
      if (!q) return true
      return (
        inst.display_name.toLowerCase().includes(q) ||
        inst.instance_id.toLowerCase().includes(q)
      )
    })
  }, [items, query, statusFilter, now])

  /** 在线 / 离线数量（底部胶囊角标） */
  const statusCounts = useMemo(() => {
    let online = 0
    let offline = 0
    for (const inst of items) {
      if (isInstanceOnline(inst.last_heartbeat_at, now)) online += 1
      else offline += 1
    }
    return { online, offline }
  }, [items, now])

  /** 切换在线/离线 Tab，原生壳轻触震动 */
  function onStatusTab(next: StatusFilter) {
    if (next === statusFilter) return
    tapHaptic()
    setStatusFilter(next)
  }

  /** Enter instance hub (unlock if needed) */
  function onEnterClick(inst: PublicInstance) {
    setMenuId(null)
    if (hasUnlockToken(inst.instance_id)) {
      navigate(`/instances/${encodeURIComponent(inst.instance_id)}`)
      return
    }
    setEnterTarget(inst)
    setEnterPassword('')
    setEnterError(null)
  }

  /** Submit 6-digit instance password */
  async function submitEnter(e?: FormEvent) {
    e?.preventDefault?.()
    if (!enterTarget || enterBusy) return
    setEnterBusy(true)
    setEnterError(null)
    try {
      await unlockInstance(enterTarget.instance_id, enterPassword.trim())
      const id = enterTarget.instance_id
      setEnterTarget(null)
      setEnterPassword('')
      const pending = loadPendingDeepLink()
      if (pending?.instanceId === id) {
        navigateToDeepLinkChat(navigate, pending, {
          pathname: window.location.pathname,
          search: window.location.search,
        })
      } else {
        navigate(`/instances/${encodeURIComponent(id)}`)
      }
    } catch (err) {
      setEnterError(err instanceof Error ? err.message : '验证失败')
    } finally {
      setEnterBusy(false)
    }
  }

  /** Confirm 注销 */
  async function confirmRevoke() {
    if (!revokeTarget) return
    const id = revokeTarget.instance_id
    setBusyId(id)
    setError(null)
    try {
      await revokeInstancePassword(id)
      setRevokeTarget(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '注销失败')
    } finally {
      setBusyId(null)
    }
  }

  function logout() {
    clearToken()
    navigate('/login', { replace: true })
  }

  const [theme, setThemeMode] = useState<ThemeMode>(() => getStoredTheme())

  /** Toggle global light/dark (persisted, applies to all pages) */
  function onToggleTheme() {
    setThemeMode(toggleTheme())
  }

  return (
    <div className="page page-fill instances-dark">
      <header className="inst-topbar">
        <div className="inst-topbar-left">
          <span className="inst-title-bar" aria-hidden />
          <h1>实例</h1>
        </div>
        <div className="inst-topbar-right">
          <button
            type="button"
            className="inst-icon-btn"
            aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}
            title={theme === 'light' ? '深色' : '浅色'}
            onClick={onToggleTheme}
          >
            {theme === 'light' ? <IconMoon size={20} /> : <IconSun size={20} />}
          </button>
          <button
            type="button"
            className="inst-icon-btn"
            aria-label="设置"
            title="设置"
            onClick={() => navigate('/settings')}
          >
            <SettingsIcon size={20} />
          </button>
          <button type="button" className="inst-logout" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      <main className="inst-body">
        <div className="inst-toolbar">
          <label className="inst-search">
            <IconSearch size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索实例名称..."
            />
          </label>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
        {loading ? <p className="inst-muted">加载中…</p> : null}

        <ul className="inst-list">
          {filtered.map((inst) => {
            const online = isInstanceOnline(inst.last_heartbeat_at, now)
            const host = inst.host || {}
            const cpu = formatPct(host.cpu_pct)
            const mem = formatPct(host.mem_pct)
            const disk = formatPct(host.disk_pct)
            const tempLabel = formatTempC(host.temp_c)
            const tempBar = tempBarPct(host.temp_c)
            const statusLabel = (inst.status || 'unknown').toLowerCase()

            return (
              <li key={inst.instance_id} className="inst-card">
                <div className="inst-card-head">
                  <div className="inst-avatar-wrap">
                    <span className="inst-avatar">
                      <IconMonitor size={28} />
                    </span>
                    <span className={`inst-live-dot ${online ? 'on' : 'off'}`} />
                  </div>
                  <div className="inst-card-title">
                    <div className="inst-name">{inst.display_name}</div>
                    <div className="inst-badges">
                      <span className={`inst-badge ${online ? 'online' : 'offline'}`}>
                        <span className="inst-badge-dot" />
                        {online ? '在线' : '离线'}
                      </span>
                      <span className="inst-badge status">{statusLabel || '—'}</span>
                    </div>
                  </div>
                  <div className="inst-menu-wrap">
                    <button
                      type="button"
                      className="inst-icon-btn"
                      aria-label="更多"
                      onClick={() =>
                        setMenuId((id) => (id === inst.instance_id ? null : inst.instance_id))
                      }
                    >
                      <IconMore size={18} />
                    </button>
                    {menuId === inst.instance_id ? (
                      <div className="inst-menu-pop">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null)
                            setDetailTarget(inst)
                          }}
                        >
                          查看详情
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            setMenuId(null)
                            setRevokeTarget(inst)
                          }}
                        >
                          注销
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="inst-meta-grid">
                  <div className="inst-meta-cell">
                    <IconMonitor size={16} />
                    <div>
                      <div className="inst-meta-label">系统</div>
                      <div className="inst-meta-value">{host.os || '—'}</div>
                    </div>
                  </div>
                  <div className="inst-meta-cell">
                    <IconChip size={16} />
                    <div>
                      <div className="inst-meta-label">IP 地址</div>
                      <div className="inst-meta-value">{host.ip || '—'}</div>
                    </div>
                  </div>
                  <div className="inst-meta-cell">
                    <IconClock size={16} />
                    <div>
                      <div className="inst-meta-label">运行时长</div>
                      <div className="inst-meta-value">{formatUptime(host.uptime_sec)}</div>
                    </div>
                  </div>
                </div>

                <div className="inst-res-grid">
                  <div className="inst-res-card">
                    <div className="inst-res-top">
                      <IconChip size={14} />
                      <span>CPU</span>
                      <strong>{cpu}%</strong>
                    </div>
                    <div className="inst-bar">
                      <div className="inst-bar-fill cpu" style={{ width: `${cpu}%` }} />
                    </div>
                  </div>
                  <div className="inst-res-card">
                    <div className="inst-res-top">
                      <IconMemory size={14} />
                      <span>内存</span>
                      <strong>{mem}%</strong>
                    </div>
                    <div className="inst-bar">
                      <div className="inst-bar-fill mem" style={{ width: `${mem}%` }} />
                    </div>
                  </div>
                  <div className="inst-res-card">
                    <div className="inst-res-top">
                      <IconDisk size={14} />
                      <span>磁盘</span>
                      <strong>{disk}%</strong>
                    </div>
                    <div className="inst-bar">
                      <div className="inst-bar-fill disk" style={{ width: `${disk}%` }} />
                    </div>
                  </div>
                  <div className="inst-res-card">
                    <div className="inst-res-top">
                      <IconTemp size={14} />
                      <span>温度</span>
                      <strong>{tempLabel}</strong>
                    </div>
                    <div className="inst-bar">
                      <div className="inst-bar-fill temp" style={{ width: `${tempBar}%` }} />
                    </div>
                  </div>
                </div>

                <div className="inst-card-actions">
                  <button
                    type="button"
                    className="inst-btn detail"
                    onClick={() => setDetailTarget(inst)}
                  >
                    <IconInfo size={16} />
                    <span>查看详情</span>
                    <IconChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="inst-btn enter"
                    onClick={() => onEnterClick(inst)}
                  >
                    <IconEnter size={16} />
                    进入
                  </button>
                  <button
                    type="button"
                    className="inst-btn revoke"
                    disabled={busyId === inst.instance_id}
                    onClick={() => setRevokeTarget(inst)}
                    aria-label="注销"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {!loading && filtered.length === 0 ? (
          <div className="inst-empty">
            <p className="inst-empty-title">
              {items.length === 0
                ? '暂无实例'
                : statusFilter === 'online'
                  ? '暂无在线实例'
                  : '暂无离线实例'}
            </p>
            <p className="inst-empty-sub">
              {items.length === 0
                ? '请先在 Mac 管理台启用远程中继并完成注册'
                : statusFilter === 'online'
                  ? '可切换到「离线」查看其它设备'
                  : '可切换到「在线」查看当前可用设备'}
            </p>
          </div>
        ) : null}
      </main>

      {/* 底部居中椭圆胶囊：在线 / 离线 */}
      <nav className="inst-status-dock" aria-label="实例状态筛选">
        <div className="inst-status-capsule" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'online'}
            className={`inst-status-tab${statusFilter === 'online' ? ' is-active' : ''}`}
            onClick={() => onStatusTab('online')}
          >
            <span className="inst-status-dot on" aria-hidden />
            在线
            <span className="inst-status-count">{statusCounts.online}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'offline'}
            className={`inst-status-tab${statusFilter === 'offline' ? ' is-active' : ''}`}
            onClick={() => onStatusTab('offline')}
          >
            <span className="inst-status-dot off" aria-hidden />
            离线
            <span className="inst-status-count">{statusCounts.offline}</span>
          </button>
        </div>
      </nav>

      <Modal
        open={!!detailTarget}
        title="实例详情"
        onClose={() => setDetailTarget(null)}
        footer={
          <button type="button" className="btn primary" onClick={() => setDetailTarget(null)}>
            关闭
          </button>
        }
      >
        {detailTarget ? (
          <div className="inst-detail">
            <p>
              <strong>名称</strong> {detailTarget.display_name}
            </p>
            <p>
              <strong>ID</strong> {detailTarget.instance_id}
            </p>
            <p>
              <strong>状态</strong>{' '}
              {isInstanceOnline(detailTarget.last_heartbeat_at, now) ? '在线' : '离线'} ·{' '}
              {detailTarget.status}
            </p>
            <p>
              <strong>系统</strong> {detailTarget.host?.os || '—'}
            </p>
            <p>
              <strong>IP</strong> {detailTarget.host?.ip || '—'}
            </p>
            <p>
              <strong>运行时长</strong> {formatUptime(detailTarget.host?.uptime_sec)}
            </p>
            <p>
              <strong>CPU / 内存 / 磁盘</strong>{' '}
              {formatPct(detailTarget.host?.cpu_pct)}% / {formatPct(detailTarget.host?.mem_pct)}% /{' '}
              {formatPct(detailTarget.host?.disk_pct)}%
            </p>
            <p>
              <strong>温度</strong> {formatTempC(detailTarget.host?.temp_c)}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!enterTarget}
        title="输入实例密码"
        onClose={() => {
          if (enterBusy) return
          setEnterTarget(null)
          if (unlockTargetId) navigate('/instances', { replace: true })
        }}
        footer={
          <>
            <button
              type="button"
              className="btn"
              disabled={enterBusy}
              onClick={() => setEnterTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={enterBusy || enterPassword.trim().length !== 6}
              onClick={() => void submitEnter()}
            >
              {enterBusy ? '验证中…' : '进入'}
            </button>
          </>
        }
      >
        <p className="muted modal-hint">
          请输入 Mac「{enterTarget?.display_name}」上的 6 位实例密码。连续错误 5 次将锁定 5 分钟。
        </p>
        {enterError ? <p className="error-banner">{enterError}</p> : null}
        <form onSubmit={(e) => void submitEnter(e)}>
          <label className="field">
            实例密码
            <input
              type="password"
              inputMode="text"
              autoComplete="off"
              maxLength={6}
              value={enterPassword}
              onChange={(e) => setEnterPassword(e.target.value)}
              placeholder="6 位数字与字母"
              autoFocus
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!revokeTarget}
        title="确认注销"
        onClose={() => !busyId && setRevokeTarget(null)}
        footer={
          <>
            <button
              type="button"
              className="btn"
              disabled={!!busyId}
              onClick={() => setRevokeTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={!!busyId}
              onClick={() => void confirmRevoke()}
            >
              {busyId ? '处理中…' : '确认注销'}
            </button>
          </>
        }
      >
        <p className="modal-hint">
          注销后，「{revokeTarget?.display_name}」的实例密码将立即失效，该 Mac 需重新生成并注册才能继续同步。
        </p>
      </Modal>
    </div>
  )
}
