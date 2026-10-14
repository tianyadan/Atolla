import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearToken,
  fetchInstances,
  hasUnlockToken,
  revokeInstancePassword,
  unlockInstance,
  type PublicInstance,
} from '../api'
import {
  IconChevronDown,
  IconChevronRight,
  IconChip,
  IconClock,
  IconDisk,
  IconEmptyMonitor,
  IconEnter,
  IconInfo,
  IconMemory,
  IconMonitor,
  IconMore,
  IconSearch,
  IconSun,
  IconTrash,
} from '../components/InstanceIcons'
import { Modal } from '../components/Modal'
import { SettingsIcon } from '../components/SettingsIcon'
import {
  formatPct,
  formatUptime,
  isInstanceOnline,
} from '../utils/instance'

type StatusFilter = 'all' | 'online' | 'offline'

/** Dark instances management — matches prototype, wired to real APIs */
export function InstancesPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<PublicInstance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
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
      navigate(`/instances/${encodeURIComponent(id)}`)
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

  /** Soft theme flip for this page (prototype sun toggle) */
  function toggleThemeHint() {
    document.documentElement.classList.toggle('force-light')
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
            aria-label="Theme"
            onClick={toggleThemeHint}
          >
            <IconSun size={20} />
          </button>
          <button
            type="button"
            className="inst-icon-btn"
            aria-label="Settings"
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
          <label className="inst-filter">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="offline">离线</option>
            </select>
            <IconChevronDown size={14} />
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
            <IconEmptyMonitor size={72} />
            <p className="inst-empty-title">
              {items.length === 0 ? '暂无实例' : '暂无更多实例'}
            </p>
            <p className="inst-empty-sub">
              {items.length === 0
                ? '请先在 Mac 管理台启用远程中继并完成注册'
                : '当前没有其他可用的实例'}
            </p>
          </div>
        ) : null}

        {!loading && filtered.length > 0 ? (
          <div className="inst-empty inst-empty-footer">
            <IconEmptyMonitor size={56} />
            <p className="inst-empty-title">暂无更多实例</p>
            <p className="inst-empty-sub">当前没有其他可用的实例</p>
          </div>
        ) : null}
      </main>

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
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!enterTarget}
        title="输入实例密码"
        onClose={() => !enterBusy && setEnterTarget(null)}
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
