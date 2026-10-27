import { useEffect, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { DbLogo } from './dbLogos.jsx'
import { copyText } from './engineCatalog.js'

const API = '/api'

const OPTIONS = [
  { id: 'sqlite', name: 'SQLite', blurb: '本地文件库，免 Docker' },
  { id: 'mysql', name: 'MySQL', blurb: '本机 Docker · 端口 3307' },
]

/** 设置页「数据库」：紧凑列表 + 迁移切换，视觉对齐其它设置分组。 */
export default function DbSettings({ authHeaders, onUnauthorized, active }) {
  const [open, setOpen] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hint, setHint] = useState('')
  /** switch：迁移确认；mysql-config：未就绪时的连接配置说明 */
  const [modal, setModal] = useState(null) // { kind: 'switch'|'mysql-config', driver? }
  const [ack, setAck] = useState(false)
  const [progress, setProgress] = useState(null)
  const [copiedKey, setCopiedKey] = useState('')

  /** 拉取状态。 */
  async function load() {
    if (typeof authHeaders !== 'function') return
    setErr('')
    try {
      const res = await fetch(`${API}/admin/db/status`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('数据库接口未就绪，请重启后端（./scripts/restart.sh）后刷新')
        }
        throw new Error(data.error || res.statusText || `HTTP ${res.status}`)
      }
      setSt(data)
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (!active) return
    load()
  }, [active])

  /** 打开切换确认（已可达 / SQLite）。 */
  function requestSwitch(driver) {
    if (!st || driver === st.driver || busy) return
    setAck(false)
    setHint('')
    setErr('')
    setModal({ kind: 'switch', driver })
  }

  /** MySQL 未就绪：配置连接弹窗，不直接切换。 */
  function openMysqlConfig() {
    if (busy) return
    setHint('')
    setErr('')
    setModal({ kind: 'mysql-config' })
  }

  /** 配置弹窗内确认后再走切换。 */
  function proceedMysqlSwitchFromConfig() {
    setAck(false)
    setModal({ kind: 'switch', driver: 'mysql' })
  }

  /** 执行切换。 */
  async function doSwitch(migrate) {
    if (!modal || modal.kind !== 'switch') return
    if (migrate && !ack) {
      setErr('请先勾选确认风险')
      return
    }
    setBusy(true)
    setErr('')
    setHint(migrate ? '正在迁移数据…' : '正在切换…')
    setProgress(migrate ? { phase: 'preparing', percent: 0 } : null)
    let poll
    if (migrate) {
      poll = setInterval(async () => {
        try {
          const res = await fetch(`${API}/admin/db/migrate-progress`, { headers: authHeaders() })
          if (res.ok) setProgress(await res.json())
        } catch {
          /* ignore */
        }
      }, 400)
    }
    try {
      const res = await fetch(`${API}/admin/db/switch`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: modal.driver, migrate }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      setModal(null)
      if (data.restart === 'pending') {
        setHint('配置已保存，正在重启服务…')
        const ok = await waitHealth(60000)
        if (ok) {
          setHint('重启完成，请刷新页面')
          await load()
        } else {
          setHint(`重启较慢，可手动执行：${data.command || './scripts/restart.sh'}`)
        }
      } else if (data.restart === 'manual') {
        setHint(`请手动执行：${data.command || './scripts/restart.sh'}`)
      } else {
        setHint(data.message || '已保存')
        await load()
      }
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      if (poll) clearInterval(poll)
      setBusy(false)
      setProgress(null)
    }
  }

  async function copyField(key, text) {
    if (!text) return
    await copyText(text)
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((k) => (k === key ? '' : k)), 1600)
  }

  const current = st?.driver || 'sqlite'
  const mysqlReady = !!(st?.mysql_reachable || st?.docker_available)
  const sqlitePath = st?.sqlite_path || ''
  const dsn = st?.dsn_display || ''

  return (
    <SettingsFold
      title="数据库"
      desc={st ? `当前 ${current === 'mysql' ? 'MySQL' : 'SQLite'}` : '平台主库：SQLite / MySQL'}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="db-settings">
        <ul className="db-option-list" role="list">
          {OPTIONS.map((d) => {
            const isCurrent = current === d.id
            const isMysql = d.id === 'mysql'
            return (
              <li key={d.id} className={`db-option-row${isCurrent ? ' is-current' : ''}`}>
                <div className="db-option-main">
                  <span className="db-option-icon" aria-hidden="true">
                    <DbLogo id={d.id} size={18} mono />
                  </span>
                  <div className="db-option-text">
                    <span className="ma-capsule-label">
                      {isCurrent ? (
                        <span className="engine-dot ok db-option-dot" title="当前使用" />
                      ) : null}
                      {d.name}
                    </span>
                    <p className="ma-capsule-hint">{d.blurb}</p>
                  </div>
                </div>
                <div className="db-option-actions">
                  {isCurrent ? (
                    <span className="db-status-tag">当前使用</span>
                  ) : isMysql && !mysqlReady ? (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => openMysqlConfig()}
                    >
                      配置连接
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => requestSwitch(d.id)}
                    >
                      切换
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          className={`db-detail-toggle${detailOpen ? ' is-open' : ''}`}
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((v) => !v)}
        >
          <span>连接详情</span>
          <svg className="db-detail-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {detailOpen ? (
          <div className="db-detail-panel">
            {dsn ? (
              <div className="db-detail-row">
                <span className="db-detail-label">DSN</span>
                <code className="db-detail-value">{dsn}</code>
                <button type="button" className="ghost" onClick={() => void copyField('dsn', dsn)}>
                  {copiedKey === 'dsn' ? '已复制' : '复制'}
                </button>
              </div>
            ) : null}
            {sqlitePath ? (
              <div className="db-detail-row">
                <span className="db-detail-label">SQLite 路径</span>
                <code className="db-detail-value">{sqlitePath}</code>
                <button type="button" className="ghost" onClick={() => void copyField('path', sqlitePath)}>
                  {copiedKey === 'path' ? '已复制' : '复制'}
                </button>
              </div>
            ) : null}
            <div className="db-detail-row">
              <span className="db-detail-label">Docker</span>
              <span className="db-detail-value muted">{st?.docker_available ? '已检测到' : '未检测到'}</span>
            </div>
            <div className="db-detail-row">
              <span className="db-detail-label">MySQL :3307</span>
              <span className="db-detail-value muted">{st?.mysql_reachable ? '可连接' : '不可达'}</span>
            </div>
          </div>
        ) : null}

        {progress ? (
          <p className="engine-hint" role="status">
            {progress.phase === 'copying' ? `拷贝 ${progress.table || ''}…` : progress.phase}
            {' · '}
            {Math.round(progress.percent || 0)}%
          </p>
        ) : null}
        {hint ? <p className="engine-hint" role="status">{hint}</p> : null}
        {err && !modal ? <p className="engine-hint" role="alert">{err}</p> : null}
      </div>

      {modal?.kind === 'mysql-config' ? (
        <div className="db-modal-backdrop" role="presentation" onClick={() => !busy && setModal(null)}>
          <div
            className="db-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="db-mysql-config-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="db-mysql-config-title">配置 MySQL 连接</h2>
            <p className="db-modal-risk">
              Atolla 使用本机 Docker 中的 MySQL（映射端口 <strong>3307</strong>，账号 root/root，库名 colleague_avatar）。
              切换时若容器未启动，后端会尝试 <code>docker compose up -d mysql</code>。
            </p>
            <ul className="db-config-status">
              <li>
                Docker：{st?.docker_available ? '已就绪' : '未检测到，请先安装并启动 Docker'}
              </li>
              <li>
                MySQL 3307：{st?.mysql_reachable ? '可连接' : '当前不可达'}
              </li>
            </ul>
            <div className="db-modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
                重新检测
              </button>
              <button
                type="button"
                className="gc-meet-btn"
                disabled={busy || !st?.docker_available}
                onClick={() => proceedMysqlSwitchFromConfig()}
                title={!st?.docker_available ? '需要本机可用的 Docker' : '进入切换确认'}
              >
                继续切换
              </button>
              <button type="button" disabled={busy} onClick={() => setModal(null)}>
                取消
              </button>
            </div>
            {err ? <p className="engine-hint" role="alert">{err}</p> : null}
          </div>
        </div>
      ) : null}

      {modal?.kind === 'switch' ? (
        <div className="db-modal-backdrop" role="presentation" onClick={() => !busy && setModal(null)}>
          <div
            className="db-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="db-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="db-modal-title">切换到 {modal.driver === 'mysql' ? 'MySQL' : 'SQLite'}</h2>
            <p className="db-modal-risk">
              「迁移并切换」会<strong>清空目标库</strong>中的全部 Atolla 数据，再从当前库覆盖导入，此操作不可撤销。
            </p>
            <label className="db-modal-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              我了解风险，确认清空目标库后迁移
            </label>
            <div className="db-modal-actions">
              <button type="button" className="engine-copy" disabled={busy || !ack} onClick={() => doSwitch(true)}>
                迁移并切换
              </button>
              <button type="button" className="engine-recheck" disabled={busy} onClick={() => doSwitch(false)}>
                仅切换空库
              </button>
              <button type="button" disabled={busy} onClick={() => setModal(null)}>
                取消
              </button>
            </div>
            {hint?.includes('手动') ? (
              <button
                type="button"
                className="engine-copy"
                onClick={async () => {
                  await copyText('./scripts/restart.sh')
                  setCopiedKey('restart')
                }}
              >
                {copiedKey === 'restart' ? '已复制命令' : '复制重启命令'}
              </button>
            ) : null}
            {err ? <p className="engine-hint" role="alert">{err}</p> : null}
          </div>
        </div>
      ) : null}
    </SettingsFold>
  )
}

/** 等待后端健康。 */
async function waitHealth(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch('/health', { cache: 'no-store' })
      if (r.ok) return true
    } catch {
      /* restarting */
    }
    await new Promise((r) => setTimeout(r, 900))
  }
  return false
}
