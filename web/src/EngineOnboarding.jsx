import { useEffect, useRef, useState } from 'react'
import { ENGINE_CATALOG, copyText, fetchSetupStatus, installCommand } from './engineCatalog.js'
import { EngineLogo } from './engineLogos.jsx'

/**
 * 首次访问：动画检查 Claude / Codex / Cursor。
 * 已安装则交给前台登录引导；都没有则让用户复制安装命令后再查所选引擎。
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
        if (data.engines.some((e) => e.installed)) readyRef.current()
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

  /** 只复查用户点选过的引擎。全部检测到后进入登录引导。 */
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
      if (still.size === 0) readyRef.current()
      else setHint('仍有所选引擎未检测到，安装后请再检查一次')
    } catch (e) {
      setHint(String(e.message || e))
    } finally {
      setChecking(false)
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
            {missed.has(e.id) && <i className="engine-dot bad" aria-label="仍未检测到" />}
          </button>
        ))}
      </div>
      <section className="engine-cmd" aria-label={`${active?.name || ''} 安装命令`}>
        <div className="engine-cmd-head">
          <span>安装 {active?.name}</span>
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
