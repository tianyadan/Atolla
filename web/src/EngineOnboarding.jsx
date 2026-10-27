import { useEffect, useRef, useState } from 'react'
import { ENGINE_CATALOG, copyText, fetchSetupStatus, installCommand } from './engineCatalog.js'
import { EngineLogo } from './engineLogos.jsx'
import { DbLogo } from './dbLogos.jsx'

const API = '/api'

const DB_OPTIONS = [
  { id: 'sqlite', name: 'SQLite', blurb: '免 Docker，单文件本地库，适合本机单人使用' },
  { id: 'mysql', name: 'MySQL', blurb: '本机 Docker 一键拉起（端口 3307）' },
]

/**
 * 首次访问：先检查 CLI 引擎，再选择数据库（默认 SQLite）。
 */
export default function EngineOnboarding({ onReady }) {
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const [phase, setPhase] = useState('scan')
  const [scanIndex, setScanIndex] = useState(0)
  const [engines, setEngines] = useState(ENGINE_CATALOG.map((e) => ({ ...e, installed: false })))
  const [activeId, setActiveId] = useState('claude')
  const [selected, setSelected] = useState(() => new Set())
  const [china, setChina] = useState(false)
  const [copied, setCopied] = useState(false)
  const [checking, setChecking] = useState(false)
  const [missed, setMissed] = useState(() => new Set())
  const [hint, setHint] = useState('')
  const [dbDriver, setDbDriver] = useState('sqlite')
  const [dbStatus, setDbStatus] = useState(null)
  const [dbBusy, setDbBusy] = useState(false)

  /** 进入数据库阶段：若已选过则直接完成引导。 */
  async function goDbPhase() {
    setPhase('db-scan')
    setHint('')
    try {
      const res = await fetch(`${API}/setup/db-status`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      setDbStatus(data)
      if (data.chosen) {
        readyRef.current()
        return
      }
      if (data.driver === 'mysql' || data.driver === 'sqlite') {
        setDbDriver(data.driver)
      }
      await new Promise((r) => setTimeout(r, 900))
      setPhase('db')
    } catch (e) {
      setHint(String(e.message || e))
      setPhase('db')
    }
  }

  useEffect(() => {
    let stop = false
    const timer = setInterval(() => {
      setScanIndex((n) => (n + 1) % ENGINE_CATALOG.length)
    }, 700)
    const started = Date.now()
    fetchSetupStatus()
      .then(async (data) => {
        const wait = Math.max(0, 1600 - (Date.now() - started))
        await new Promise((r) => setTimeout(r, wait))
        if (stop) return
        setEngines(data.engines)
        if (data.engines.some((e) => e.installed)) await goDbPhase()
        else setPhase('install')
      })
      .catch((e) => {
        if (stop) return
        setHint(String(e.message || e))
        setPhase('install')
      })
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [])

  const active = engines.find((e) => e.id === activeId) || engines[0]
  const command = installCommand(active, china)

  /** 点选一张引擎卡，并展示它的安装命令。 */
  function pick(id) {
    setActiveId(id)
    setCopied(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 复制当前引擎的安装命令。 */
  async function copyCmd() {
    await copyText(command)
    setCopied(true)
  }

  /** 只复查用户点选过的引擎。全部检测到后进入数据库引导。 */
  async function recheck() {
    if (selected.size === 0) {
      setHint('请先点选要安装的引擎')
      return
    }
    setChecking(true)
    setHint('')
    try {
      const data = await fetchSetupStatus()
      setEngines(data.engines)
      const still = new Set()
      for (const id of selected) {
        const row = data.engines.find((e) => e.id === id)
        if (!row?.installed) still.add(id)
      }
      setMissed(still)
      if (still.size === 0) await goDbPhase()
      else setHint('仍有所选引擎未检测到，安装后请再检查一次')
    } catch (e) {
      setHint(String(e.message || e))
    } finally {
      setChecking(false)
    }
  }

  /** 刷新 Docker / MySQL 探测。 */
  async function refreshDbStatus() {
    try {
      const res = await fetch(`${API}/setup/db-status`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setDbStatus(data)
    } catch {
      /* ignore */
    }
  }

  /** 确认数据库选择并继续。 */
  async function confirmDb() {
    setDbBusy(true)
    setHint('')
    try {
      if (dbDriver === 'mysql') await refreshDbStatus()
      const res = await fetch(`${API}/setup/db-choose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: dbDriver, migrate: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      if (data.restart === 'pending') {
        setHint('正在重启以应用数据库配置…')
        await waitHealth(45000)
      } else if (data.restart === 'manual') {
        setHint(`请手动执行 ${data.command || './scripts/restart.sh'} 后刷新页面`)
        return
      }
      readyRef.current()
    } catch (e) {
      setHint(String(e.message || e))
      await refreshDbStatus()
    } finally {
      setDbBusy(false)
    }
  }

  if (phase === 'scan') {
    return (
      <div className="engine-gate" role="status" aria-live="polite">
        <p className="engine-kicker">Atolla</p>
        <h1>正在检查工作引擎</h1>
        <ul className="engine-scan-list">
          {ENGINE_CATALOG.map((e, i) => (
            <li key={e.id} className={i === scanIndex ? 'is-on' : ''}>
              <EngineLogo id={e.id} />
              <span>{e.name}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (phase === 'db-scan') {
    return (
      <div className="engine-gate" role="status" aria-live="polite">
        <p className="engine-kicker">Atolla</p>
        <h1>正在检查数据库环境</h1>
        <ul className="engine-scan-list">
          {DB_OPTIONS.map((d) => (
            <li key={d.id} className="is-on">
              <DbLogo id={d.id} />
              <span>{d.name}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (phase === 'db') {
    const mysqlOk = dbStatus?.mysql_reachable
    const dockerOk = dbStatus?.docker_available
    return (
      <div className="engine-gate" role="dialog" aria-modal="true" aria-labelledby="db-gate-title">
        <p className="engine-kicker">数据库</p>
        <h1 id="db-gate-title">选择平台数据库</h1>
        <p className="engine-lead">默认 SQLite。若需 MySQL，将使用本机 Docker（端口 3307）。</p>
        <div className="engine-card-grid db-card-grid">
          {DB_OPTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`engine-pick${dbDriver === d.id ? ' is-selected is-active' : ''}`}
              onClick={() => { setDbDriver(d.id); setHint('') }}
              aria-pressed={dbDriver === d.id}
            >
              <DbLogo id={d.id} size={36} />
              <strong>{d.name}</strong>
              <span>{d.blurb}</span>
              {d.id === 'mysql' && (
                <span className="engine-lock-ver">
                  {!dockerOk ? '需安装 Docker' : mysqlOk ? 'MySQL 可达' : '将自动启动容器'}
                </span>
              )}
            </button>
          ))}
        </div>
        {hint && <p className="engine-hint" role="status">{hint}</p>}
        <button type="button" className="engine-recheck" onClick={confirmDb} disabled={dbBusy}>
          {dbBusy ? '正在配置…' : '继续'}
        </button>
      </div>
    )
  }

  return (
    <div className="engine-gate" role="dialog" aria-modal="true" aria-labelledby="engine-gate-title">
      <p className="engine-kicker">需要一个工作引擎</p>
      <h1 id="engine-gate-title">还没有检测到 Claude、Codex 或 Cursor</h1>
      <p className="engine-lead">点选要安装的引擎，复制命令到终端执行。国内网络可勾选镜像。</p>
      <div className="engine-card-grid">
        {engines.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`engine-pick${selected.has(e.id) ? ' is-selected' : ''}${activeId === e.id ? ' is-active' : ''}`}
            onClick={() => pick(e.id)}
            aria-pressed={selected.has(e.id)}
          >
            <EngineLogo id={e.id} />
            <strong>{e.name}</strong>
            <span>{e.blurb}</span>
            {e.version ? <span className="engine-lock-ver">锁定 v{e.version}</span> : null}
            {missed.has(e.id) && <i className="engine-dot bad" aria-label="仍未检测到" />}
          </button>
        ))}
      </div>
      <section className="engine-cmd" aria-label={`${active?.name || ''} 安装命令`}>
        <div className="engine-cmd-head">
          <span>
            安装 {active?.name}
            {active?.version ? ` · 锁定 ${active.version}` : ''}
          </span>
          <label className="engine-mirror">
            <input type="checkbox" checked={china} onChange={(ev) => { setChina(ev.target.checked); setCopied(false) }} />
            China-mirror
          </label>
        </div>
        <pre>{command}</pre>
        {active?.note && <p className="engine-note">{active.note}</p>}
        <button type="button" className="engine-copy" onClick={copyCmd}>{copied ? '已复制' : '复制命令'}</button>
      </section>
      {hint && <p className="engine-hint" role="status">{hint}</p>}
      <button type="button" className="engine-recheck" onClick={recheck} disabled={checking}>
        {checking ? '正在重新检查…' : '重新检查环境'}
      </button>
    </div>
  )
}

/** 轮询 /health 直至可用或超时。 */
async function waitHealth(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch('/health', { cache: 'no-store' })
      if (r.ok) return true
    } catch {
      /* restarting */
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  return false
}
