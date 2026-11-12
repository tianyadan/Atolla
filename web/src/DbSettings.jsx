import { useEffect, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { DbLogo } from './dbLogos.jsx'
import { copyText } from './engineCatalog.js'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

const DRIVER_IDS = [
  { id: 'sqlite', name: 'SQLite' },
  { id: 'mysql', name: 'MySQL' },
]

/** 设置页「数据库」：紧凑列表 + 迁移切换，视觉对齐其它设置分组。 */
export default function DbSettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const OPTIONS = DRIVER_IDS.map((d) => ({
    ...d,
    blurb: d.id === 'mysql' ? t('settings.db.mysqlBlurb') : t('settings.db.sqliteBlurb'),
  }))
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
          throw new Error(t('settings.db.apiMissing'))
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
      setErr(t('settings.db.needAck'))
      return
    }
    setBusy(true)
    setErr('')
    setHint(migrate ? t('settings.db.migrating') : t('settings.db.switching'))
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
        setHint(t('settings.db.savedRestarting'))
        const ok = await waitHealth(60000)
        if (ok) {
          setHint(t('settings.db.restartDone'))
          await load()
        } else {
          setHint(t('settings.db.restartSlow', { cmd: data.command || './scripts/restart.sh' }))
        }
      } else if (data.restart === 'manual') {
        setHint(t('settings.db.manualRestart', { cmd: data.command || './scripts/restart.sh' }))
      } else {
        setHint(data.message || t('settings.db.saved'))
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
      title={t('settings.db')}
      desc={
        st
          ? t('settings.dbCurrent', { name: current === 'mysql' ? 'MySQL' : 'SQLite' })
          : t('settings.dbDesc')
      }
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
                        <span className="engine-dot ok db-option-dot" title={t('settings.db.inUse')} />
                      ) : null}
                      {d.name}
                    </span>
                    <p className="ma-capsule-hint">{d.blurb}</p>
                  </div>
                </div>
                <div className="db-option-actions">
                  {isCurrent ? (
                    <span className="db-status-tag">{t('settings.db.inUse')}</span>
                  ) : isMysql && !mysqlReady ? (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => openMysqlConfig()}
                    >
                      {t('settings.db.configure')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => requestSwitch(d.id)}
                    >
                      {t('settings.db.switch')}
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
          <span>{t('settings.db.details')}</span>
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
                  {copiedKey === 'dsn' ? t('settings.common.copied') : t('settings.common.copy')}
                </button>
              </div>
            ) : null}
            {sqlitePath ? (
              <div className="db-detail-row">
                <span className="db-detail-label">{t('settings.db.sqlitePath')}</span>
                <code className="db-detail-value">{sqlitePath}</code>
                <button type="button" className="ghost" onClick={() => void copyField('path', sqlitePath)}>
                  {copiedKey === 'path' ? t('settings.common.copied') : t('settings.common.copy')}
                </button>
              </div>
            ) : null}
            <div className="db-detail-row">
              <span className="db-detail-label">Docker</span>
              <span className="db-detail-value muted">{st?.docker_available ? t('settings.db.dockerDetected') : t('settings.db.dockerMissing')}</span>
            </div>
            <div className="db-detail-row">
              <span className="db-detail-label">MySQL :3307</span>
              <span className="db-detail-value muted">{st?.mysql_reachable ? t('settings.db.mysqlOk') : t('settings.db.mysqlDown')}</span>
            </div>
          </div>
        ) : null}

        {progress ? (
          <p className="engine-hint" role="status">
            {progress.phase === 'copying' ? t('settings.db.copying', { table: progress.table || '' }) : progress.phase}
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
            <h2 id="db-mysql-config-title">{t('settings.db.mysqlConfigTitle')}</h2>
            <p className="db-modal-risk">
              {t('settings.db.mysqlConfigBody')}
            </p>
            <ul className="db-config-status">
              <li>
                {st?.docker_available ? t('settings.db.dockerReady') : t('settings.db.dockerNeed')}
              </li>
              <li>
                {st?.mysql_reachable ? t('settings.db.mysqlReady') : t('settings.db.mysqlUnreachable')}
              </li>
            </ul>
            <div className="db-modal-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
                {t('settings.common.recheck')}
              </button>
              <button
                type="button"
                className="gc-meet-btn"
                disabled={busy || !st?.docker_available}
                onClick={() => proceedMysqlSwitchFromConfig()}
                title={!st?.docker_available ? t('settings.db.needDocker') : t('settings.db.enterConfirm')}
              >
                {t('settings.db.continueSwitch')}
              </button>
              <button type="button" disabled={busy} onClick={() => setModal(null)}>
                {t('settings.common.cancel')}
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
            <h2 id="db-modal-title">{t('settings.db.switchTo', { name: modal.driver === 'mysql' ? 'MySQL' : 'SQLite' })}</h2>
            <p className="db-modal-risk">
              {t('settings.db.migrateRisk')}
            </p>
            <label className="db-modal-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              {t('settings.db.ack')}
            </label>
            <div className="db-modal-actions">
              <button type="button" className="engine-copy" disabled={busy || !ack} onClick={() => doSwitch(true)}>
                {t('settings.db.migrateSwitch')}
              </button>
              <button type="button" className="engine-recheck" disabled={busy} onClick={() => doSwitch(false)}>
                {t('settings.db.switchEmpty')}
              </button>
              <button type="button" disabled={busy} onClick={() => setModal(null)}>
                {t('settings.common.cancel')}
              </button>
            </div>
            {hint?.includes('手动') || hint?.includes('manually') || hint?.includes('Run manually') ? (
              <button
                type="button"
                className="engine-copy"
                onClick={async () => {
                  await copyText('./scripts/restart.sh')
                  setCopiedKey('restart')
                }}
              >
                {copiedKey === 'restart' ? t('settings.db.copiedRestart') : t('settings.db.copyRestart')}
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
