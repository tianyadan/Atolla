import { useCallback, useEffect, useRef, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'
const XCODE_PATH_KEY = 'atolla.ios.xcodePath'
const DEFAULT_XCODE_PATH = '/Applications/Xcode.app'

function loadSavedXcodePath() {
  try {
    return window.localStorage.getItem(XCODE_PATH_KEY) || ''
  } catch {
    return ''
  }
}

/** 构建阶段 → 进度上限（真实日志推进；中间缓增） */
const PHASE_CAP = {
  idle: 0,
  queuing: 8,
  preflight: 18,
  web_sync: 42,
  native_build: 78,
  install_run: 92,
  done: 100,
  failed: 100,
}

/**
 * 管理台一级菜单「App」：应用信息 / 真机构建配置 / 构建操作 / 日志 / 记录。
 * 文案走 i18n；字号对齐设置页 capsule（13/12/11）。
 */
export default function AppPanel({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const [infoOpen, setInfoOpen] = useState(true)
  const [cfgOpen, setCfgOpen] = useState(true)
  const [opsOpen, setOpsOpen] = useState(true)
  const [logOpen, setLogOpen] = useState(true)
  const [histOpen, setHistOpen] = useState(false)

  const [info, setInfo] = useState(null)
  const [history, setHistory] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [phaseKey, setPhaseKey] = useState('idle')
  const [jobRunning, setJobRunning] = useState(false)
  const [jobLogs, setJobLogs] = useState([])
  const [progressPct, setProgressPct] = useState(0)
  const [xcodePath, setXcodePath] = useState(loadSavedXcodePath)
  const [xcodeDialogOpen, setXcodeDialogOpen] = useState(false)
  const [xcodePathDraft, setXcodePathDraft] = useState('')
  const [pendingBuildMode, setPendingBuildMode] = useState('')
  const logEndRef = useRef(null)
  const jobAbortRef = useRef(null)
  const progressTimerRef = useRef(0)
  const phaseKeyRef = useRef('idle')

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/ios-app/info`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      setInfo(d)
      setErr('')
    } catch (e) {
      setErr(String(e.message || e))
    }
  }, [authHeaders, onUnauthorized])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/ios-app/builds`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      setHistory(Array.isArray(d.items) ? d.items : [])
    } catch {
      /* 历史非关键 */
    }
  }, [authHeaders, onUnauthorized])

  useEffect(() => {
    if (!active) return undefined
    // 页面激活时立即同步本机构建状态，后续再按周期刷新。
    // eslint-disable-next-line react/set-state-in-effect
    void loadInfo()
    void loadHistory()
    const tmr = window.setInterval(() => {
      void loadInfo()
      void loadHistory()
    }, 15_000)
    return () => window.clearInterval(tmr)
  }, [active, loadInfo, loadHistory])

  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [jobLogs])

  /** 构建中缓增进度条，不超过当前阶段 cap */
  useEffect(() => {
    if (!jobRunning) {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current)
        progressTimerRef.current = 0
      }
      return undefined
    }
    progressTimerRef.current = window.setInterval(() => {
      const cap = PHASE_CAP[phaseKeyRef.current] ?? 90
      setProgressPct((p) => {
        if (p >= cap) return p
        const next = p + (cap - p) * 0.12 + 0.8
        return Math.min(cap, Math.round(next * 10) / 10)
      })
    }, 700)
    return () => {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current)
        progressTimerRef.current = 0
      }
    }
  }, [jobRunning])

  /** 更新阶段并抬进度下限 */
  function setPhase(next) {
    phaseKeyRef.current = next
    setPhaseKey(next)
    const floor = PHASE_CAP[next] ?? 0
    setProgressPct((p) => Math.max(p, Math.min(floor, floor === 100 ? 100 : floor * 0.55)))
  }

  /** 订阅构建 SSE */
  async function streamBuildJob(jobId) {
    jobAbortRef.current?.abort?.()
    const ac = new AbortController()
    jobAbortRef.current = ac
    const res = await fetch(`${API}/admin/ios-app/build-job/${encodeURIComponent(jobId)}/stream`, {
      headers: authHeaders(),
      signal: ac.signal,
    })
    if (res.status === 401) {
      onUnauthorized?.()
      throw new Error('Unauthorized')
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `stream failed (${res.status})`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no response body')
    const decoder = new TextDecoder()
    let buf = ''
    let terminal = null
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      while (true) {
        const idx = buf.indexOf('\n\n')
        if (idx < 0) break
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const evLine = block.split('\n').find((l) => l.startsWith('event:'))
        const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
        if (!evLine || !dataLine) continue
        const ev = evLine.slice(6).trim()
        let data = {}
        try {
          data = JSON.parse(dataLine.slice(5).trim())
        } catch {
          continue
        }
        if (ev === 'log' && data.line != null) {
          const line = String(data.line)
          setJobLogs((prev) => [...prev, line])
          const inferred = inferPhaseKey(line)
          if (inferred) setPhase(inferred)
        } else if (ev === 'done') {
          terminal = 'ok'
        } else if (ev === 'error') {
          terminal = 'error'
          if (data.error) setJobLogs((prev) => [...prev, `ERROR: ${data.error}`])
        }
      }
      if (terminal) break
    }
    return terminal || 'error'
  }

  function openXcodeDialog(mode = '') {
    setPendingBuildMode(mode)
    setXcodePathDraft(xcodePath || info?.xcode_path || DEFAULT_XCODE_PATH)
    setXcodeDialogOpen(true)
  }

  /** 保存本机 Xcode 路径；由构建按钮触发时保存后直接继续。 */
  function confirmXcodePath(event) {
    event.preventDefault()
    const path = xcodePathDraft.trim().replace(/\/$/, '')
    if (!path.startsWith('/') || (!path.endsWith('.app') && !path.endsWith('/Contents/Developer'))) {
      setErr(t('app.xcodePathInvalid'))
      return
    }
    try {
      window.localStorage.setItem(XCODE_PATH_KEY, path)
    } catch {
      // 浏览器禁用本地存储时仍允许本次构建继续。
    }
    setXcodePath(path)
    setXcodeDialogOpen(false)
    setErr('')
    const mode = pendingBuildMode
    setPendingBuildMode('')
    if (mode) void buildAndRun(mode, path)
  }

  /** 按指定方式构建、安装并运行到锁定真机。 */
  async function buildAndRun(mode = 'incremental', selectedXcodePath = xcodePath) {
    if (jobRunning) return
    if (!info?.xcode_ok && !selectedXcodePath) {
      openXcodeDialog(mode)
      return
    }
    setErr('')
    setMsg('')
    setJobLogs([])
    setProgressPct(4)
    setPhase('queuing')
    setJobRunning(true)
    setLogOpen(true)
    try {
      const res = await fetch(`${API}/admin/ios-app/build-and-run`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode, xcode_path: selectedXcodePath || '' }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      setPhase('preflight')
      const terminal = await streamBuildJob(d.job_id)
      if (terminal === 'ok') {
        setPhase('done')
        setProgressPct(100)
        setMsg(t('app.buildSuccess'))
      } else {
        setPhase('failed')
        setProgressPct(100)
        setErr(t('app.buildFailed'))
      }
      void loadInfo()
      void loadHistory()
    } catch (e) {
      setErr(String(e.message || e))
      setPhase('failed')
      setProgressPct(100)
    } finally {
      setJobRunning(false)
    }
  }

  const versionLabel = info
    ? `${info.version || '—'} (${info.build_number || '—'})`
    : t('app.loading')
  const canBuildBase = !!info?.darwin_ok && !!info?.script_ok && !!info?.target_ok && !!info?.device_udid
  const xcodeReady = !!info?.xcode_ok || !!xcodePath
  const canBuild = canBuildBase && xcodeReady
  const deviceOnline = !!info?.device_udid && !!info?.darwin_ok
  const phaseLabel = t(`app.phase.${phaseKey}`) || phaseKey
  const showProgress = jobRunning || phaseKey === 'done' || phaseKey === 'failed'

  return (
    <section className="settings-page app-page">
      <header className="app-page-hero">
        <div className="app-page-hero-copy">
          <h2 className="settings-page-title">{t('nav.app')}</h2>
          <p className="app-page-lead">{t('app.lead')}</p>
          <p className="ma-capsule-hint">
            {xcodePath && !info?.xcode_ok ? t('app.xcodeCustomReady') : (info?.detail || t('app.hintIdle'))}
          </p>
        </div>
        <AppIPhoneSvg
          online={deviceOnline}
          building={jobRunning}
          version={info ? `${info.version || '—'}` : '—'}
          deviceName={info?.device_name || t('app.deviceUnlocked')}
        />
      </header>

      {err ? <p className="error app-page-banner">{err}</p> : null}
      {msg ? <p className="muted app-page-banner">{msg}</p> : null}

      <SettingsFold
        title={t('app.infoTitle')}
        desc={t('app.infoDesc')}
        open={infoOpen}
        onToggle={() => setInfoOpen((v) => !v)}
      >
        <div className="app-info-grid">
          <InfoRow label={t('app.label.version')} value={versionLabel} />
          <InfoRow label={t('app.label.bundleId')} value={info?.bundle_id || '—'} />
          <InfoRow label={t('app.label.displayName')} value={info?.display_name || 'Atolla'} />
          <InfoRow label={t('app.label.minOs')} value={info?.min_os ? `iOS ${info.min_os}` : '—'} />
          <InfoRow label={t('app.label.team')} value={info?.team_id || '—'} />
        </div>
      </SettingsFold>

      <SettingsFold
        title={t('app.configTitle')}
        desc={t('app.configDesc')}
        open={cfgOpen}
        onToggle={() => setCfgOpen((v) => !v)}
      >
        <div className="app-info-grid">
          <InfoRow label={t('app.label.targetMode')} value={t('app.targetModeValue')} />
          <InfoRow
            label={t('app.label.device')}
            value={
              info?.device_name
                ? `${info.device_name}${info.device_model ? ` · ${info.device_model}` : ''}${info.device_os ? ` · iOS ${info.device_os}` : ''}`
                : t('app.deviceUnlocked')
            }
          />
          <InfoRow label={t('app.label.udid')} value={info?.device_udid || '—'} />
          <InfoRow label={t('app.label.destination')} value={info?.destination || '—'} />
          <InfoRow label={t('app.label.scheme')} value={info?.scheme || 'App'} />
          <InfoRow label={t('app.label.xcodePath')} value={xcodePath || info?.xcode_path || t('app.xcodeSystemDefault')} />
          <InfoRow
            label={t('app.label.env')}
            value={[
              info?.darwin_ok ? 'macOS✓' : 'macOS✗',
              xcodeReady ? (xcodePath ? `${t('app.env.xcodeCustom')}✓` : 'Xcode✓') : 'Xcode✗',
              info?.script_ok ? `${t('app.env.script')}✓` : `${t('app.env.script')}✗`,
              info?.target_ok ? `${t('app.env.lock')}✓` : `${t('app.env.lock')}✗`,
            ].join(' · ')}
          />
        </div>
      </SettingsFold>

      <SettingsFold
        title={t('app.opsTitle')}
        desc={t('app.opsDesc')}
        open={opsOpen}
        onToggle={() => setOpsOpen((v) => !v)}
      >
        <div className="app-ops-row">
          <button
            type="button"
            className="gc-meet-btn"
            disabled={jobRunning || !canBuildBase}
            onClick={() => void buildAndRun('incremental')}
            title={canBuildBase ? t('app.incrementalTitle') : t('app.buildTitleBlocked')}
          >
            {jobRunning ? t('app.building') : t('app.incrementalBuild')}
          </button>
          <button
            type="button"
            className="outline"
            disabled={jobRunning || !canBuildBase}
            onClick={() => void buildAndRun('full')}
            title={canBuildBase ? t('app.fullTitle') : t('app.buildTitleBlocked')}
          >
            {t('app.fullBuild')}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={jobRunning}
            onClick={() => openXcodeDialog('')}
          >
            {t('app.configureXcode')}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={jobRunning}
            onClick={() => { void loadInfo(); void loadHistory() }}
          >
            {t('app.refresh')}
          </button>
          <span className="ma-capsule-hint">
            {t('app.currentPhase')}: {phaseLabel}
          </span>
        </div>

        {showProgress ? (
          <div className="island-boot-progress app-build-progress" aria-live="polite">
            <div className="island-boot-track">
              <div
                className={`island-boot-fill${jobRunning ? ' is-animating' : ''}${phaseKey === 'failed' ? ' is-failed' : ''}${phaseKey === 'done' ? ' is-done' : ''}`}
                style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
              />
            </div>
            <p className="island-boot-label">
              {phaseLabel}
              {jobRunning ? ` · ${Math.round(progressPct)}%` : ''}
            </p>
          </div>
        ) : null}

        {!canBuild ? (
          <p className="ma-capsule-hint" style={{ marginTop: 8 }}>
            {t('app.buildBlockedHint')}
          </p>
        ) : null}
      </SettingsFold>

      <SettingsFold
        title={t('app.logTitle')}
        desc={t('app.logDesc')}
        open={logOpen}
        onToggle={() => setLogOpen((v) => !v)}
      >
        <pre className="app-build-log">
          {jobLogs.length ? jobLogs.join('\n') : t('app.logEmpty')}
          <div ref={logEndRef} />
        </pre>
      </SettingsFold>

      <SettingsFold
        title={t('app.historyTitle')}
        desc={t('app.historyDesc')}
        open={histOpen}
        onToggle={() => setHistOpen((v) => !v)}
      >
        {history.length === 0 ? (
          <p className="ma-capsule-hint">{t('app.historyEmpty')}</p>
        ) : (
          <ul className="app-history-list">
            {history.map((h) => (
              <li key={h.id}>
                <span className="ma-capsule-label">
                  {h.ok ? t('app.status.ok') : (h.finished_at ? t('app.status.fail') : t('app.status.running'))}
                </span>
                <span className="ma-capsule-hint">
                  {' · '}
                  {h.version || '—'} ({h.build || '—'})
                  {h.mode ? ` · ${h.mode === 'full' ? t('app.fullBuild') : t('app.incrementalBuild')}` : ''}
                  {' · '}
                  {h.device || t('app.deviceGeneric')}
                  {' · '}
                  {h.started_at}
                  {h.error ? <span className="error"> — {h.error}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsFold>

      {xcodeDialogOpen ? (
        <div className="modal-mask" role="presentation" onMouseDown={() => setXcodeDialogOpen(false)}>
          <form
            className="modal-card app-xcode-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('app.xcodeDialogTitle')}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={confirmXcodePath}
          >
            <h2>{t('app.xcodeDialogTitle')}</h2>
            <p className="ma-capsule-hint">{t('app.xcodeDialogHint')}</p>
            <label>
              {t('app.label.xcodePath')}
              <input
                autoFocus
                value={xcodePathDraft}
                placeholder={DEFAULT_XCODE_PATH}
                onChange={(event) => setXcodePathDraft(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="ghost app-xcode-default"
              onClick={() => setXcodePathDraft(info?.xcode_path || DEFAULT_XCODE_PATH)}
            >
              {t('app.useDefaultXcode')}: {info?.xcode_path || DEFAULT_XCODE_PATH}
            </button>
            <div className="modal-actions">
              <button type="button" onClick={() => setXcodeDialogOpen(false)}>{t('settings.notify.cancel')}</button>
              <button type="submit">{pendingBuildMode ? t('app.saveAndBuild') : t('app.saveXcode')}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}

/** 信息行：对齐设置页 13/12 字号 */
function InfoRow({ label, value }) {
  return (
    <div className="app-info-row">
      <span className="ma-capsule-hint app-info-label">{label}</span>
      <span className="ma-capsule-label app-info-value">{value}</span>
    </div>
  )
}

/** 高端 iPhone 线稿展示 */
function AppIPhoneSvg({ online, building, version, deviceName }) {
  return (
    <div className={`app-iphone${building ? ' is-building' : ''}${online ? ' is-online' : ''}`} aria-hidden>
      <svg className="app-iphone-svg" viewBox="0 0 120 240" fill="none">
        <defs>
          <linearGradient id="appPhoneGlass" x1="20" y1="18" x2="100" y2="210" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2a2a2e" />
            <stop offset="0.45" stopColor="#141416" />
            <stop offset="1" stopColor="#0a0a0c" />
          </linearGradient>
          <linearGradient id="appPhoneFrame" x1="0" y1="0" x2="120" y2="240" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d4d4d8" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#71717a" stopOpacity="0.35" />
            <stop offset="1" stopColor="#a1a1aa" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <rect x="8" y="6" width="104" height="228" rx="26" stroke="url(#appPhoneFrame)" strokeWidth="2.2" fill="#09090b" />
        <rect x="14" y="14" width="92" height="212" rx="20" fill="url(#appPhoneGlass)" />
        <rect x="42" y="20" width="36" height="8" rx="4" fill="#000" opacity="0.85" />
        <circle cx="86" cy="24" r="3.2" fill={online ? '#22c55e' : '#52525b'} className={online ? 'app-iphone-led' : undefined} />
        <text x="60" y="108" textAnchor="middle" fill="#f4f4f5" fontSize="13" fontFamily="system-ui,sans-serif" fontWeight="600">
          Atolla
        </text>
        <text x="60" y="128" textAnchor="middle" fill="#a1a1aa" fontSize="9" fontFamily="system-ui,sans-serif">
          {version}
        </text>
        <text x="60" y="148" textAnchor="middle" fill="#71717a" fontSize="8" fontFamily="system-ui,sans-serif">
          {String(deviceName || '').slice(0, 18)}
        </text>
        {building ? (
          <rect x="34" y="168" width="52" height="4" rx="2" fill="#27272a">
            <animate attributeName="opacity" values="0.45;1;0.45" dur="1.2s" repeatCount="indefinite" />
          </rect>
        ) : (
          <rect x="48" y="196" width="24" height="3" rx="1.5" fill="#3f3f46" />
        )}
      </svg>
    </div>
  )
}

/** 根据日志行推断阶段 key */
function inferPhaseKey(line) {
  const s = String(line || '')
  if (s.includes('[preflight]')) return 'preflight'
  if (s.includes('[web_sync]') || s.includes('cap:copy') || s.includes('build web')) return 'web_sync'
  if (s.includes('[native_build]') || s.includes('xcodebuild')) return 'native_build'
  if (s.includes('[install_run]') || s.includes('install app') || s.includes('process launch')) return 'install_run'
  if (s.includes('finished OK') || s.includes('done OK')) return 'done'
  if (s.startsWith('error:') || s.startsWith('ERROR:')) return 'failed'
  return ''
}
