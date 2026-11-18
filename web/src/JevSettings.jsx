import { useEffect, useRef, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

const EMPTY_STEPS = []

/** Progress step labels for JEV actions */
function jevSteps(t, mode) {
  switch (mode) {
    case 'install':
      return [
        t('settings.jev.step.connect'),
        t('settings.jev.step.downloadRuntime'),
        t('settings.jev.step.downloadModel'),
        t('settings.jev.step.extract'),
        t('settings.jev.step.almost'),
      ]
    case 'enable':
      return [
        t('settings.jev.step.register'),
        t('settings.jev.step.start'),
        t('settings.jev.step.health'),
        t('settings.jev.step.almost'),
      ]
    case 'disable':
      return [t('settings.jev.step.disable'), t('settings.jev.step.almost')]
    case 'uninstall':
      return [
        t('settings.jev.step.stop'),
        t('settings.jev.step.archive'),
        t('settings.jev.step.almost'),
      ]
    default:
      return EMPTY_STEPS
  }
}

/** Fake staged progress while waiting on a backend call with no real stream */
function useStagedProgress(active, steps, doneLabel) {
  const [pct, setPct] = useState(0)
  const [label, setLabel] = useState('')
  const timerRef = useRef(0)
  const stepRef = useRef(0)

  useEffect(() => {
    if (!active || !steps?.length) {
      setPct(0)
      setLabel('')
      stepRef.current = 0
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = 0
      return undefined
    }
    stepRef.current = 0
    setLabel(steps[0])
    setPct(6)
    timerRef.current = window.setInterval(() => {
      stepRef.current = Math.min(steps.length - 1, stepRef.current + 1)
      setLabel(steps[stepRef.current])
      setPct((p) => Math.min(92, Math.round(p + (92 - p) * 0.12 + 2)))
    }, 2200)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = 0
    }
  }, [active, steps])

  function finish() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = 0
    }
    setPct(100)
    setLabel(doneLabel || '')
  }

  return { pct, label, finish }
}

/**
 * 设置 · JEV：检测本机 → 未安装则选 GitHub Release 包安装 → 胶囊启停。
 * 开启是数字人「AI 自动审核」的前置条件。
 */
export default function JevSettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progressMode, setProgressMode] = useState(null)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
	const [chinaMirror, setChinaMirror] = useState(false)
	const [slowInstall, setSlowInstall] = useState(false)
	const [installFailed, setInstallFailed] = useState(false)
	const slowTimerRef = useRef(0)
  /** 点击「安装」后再展开下载列表，避免未装就铺开选项 */
  const [showPkgList, setShowPkgList] = useState(false)
  const [st, setSt] = useState({
    installed: false,
    enabled: false,
    healthy: false,
    detail: '',
    packages: [],
    release_url: '',
    release_tag: '',
    cached: false,
    checked_at: '',
    can_uninstall: false,
  })

  const stepList = jevSteps(t, progressMode)
  const progress = useStagedProgress(!!progressMode, stepList, t('settings.common.done'))

  function applyStatus(d) {
    const pkgs = Array.isArray(d.packages) ? d.packages : []
    setSt({
      installed: !!d.installed,
      enabled: !!d.enabled,
      healthy: !!d.healthy,
      detail: d.detail || '',
      packages: pkgs,
      release_url: d.release_url || '',
      release_tag: d.release_tag || '',
      cached: !!d.cached,
      checked_at: d.checked_at || '',
      can_uninstall: !!d.can_uninstall,
    })
    if (!pick) {
      const rec = pkgs.find((p) => p.recommended)
      setPick(rec?.id || pkgs[0]?.id || '')
    }
  }

  async function endProgress(ok) {
    if (ok) progress.finish()
    await new Promise((r) => setTimeout(r, ok ? 420 : 0))
    setProgressMode(null)
    setBusy(false)
  }

  async function load(force = false) {
    setErr('')
    try {
      const q = force ? '?force=1' : ''
      const res = await fetch(`${API}/admin/jevos/settings${q}`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || d.detail || `加载失败(${res.status})`)
      applyStatus(d)
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 从 GitHub Release 安装所选包 */
  async function install() {
    if (!pick) {
      setErr(t('settings.jev.needPkg'))
      return
    }
    setBusy(true)
    setProgressMode('install')
    setErr('')
	setSlowInstall(false)
	setInstallFailed(false)
	slowTimerRef.current = window.setTimeout(() => setSlowInstall(true), 120_000)
    try {
      const res = await fetch(`${API}/admin/jevos/settings/install`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ package_id: pick, china_mirror: chinaMirror }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        setProgressMode(null)
        setBusy(false)
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        applyStatus(d)
        throw new Error(d.error || d.detail || `安装失败(${res.status})`)
      }
      applyStatus(d)
      setShowPkgList(false)
      await endProgress(true)
    } catch (e) {
      setErr(String(e.message || e))
	  setInstallFailed(true)
      setProgressMode(null)
      setBusy(false)
	} finally {
	  if (slowTimerRef.current) window.clearTimeout(slowTimerRef.current)
	  slowTimerRef.current = 0
	  setSlowInstall(false)
    }
  }

  /** 卸载平台安装的 JEV（归档 ~/.atolla/jevos，不直接 rm） */
  async function uninstall() {
    if (!st.can_uninstall && !st.installed) {
      setErr(t('settings.jev.noUninstall'))
      return
    }
    if (!window.confirm(t('settings.jev.confirmUninstall'))) {
      return
    }
    setBusy(true)
    setProgressMode('uninstall')
    setErr('')
    try {
      const res = await fetch(`${API}/admin/jevos/settings/uninstall`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
      })
      if (res.status === 401) {
        onUnauthorized?.()
        setProgressMode(null)
        setBusy(false)
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        applyStatus(d)
        throw new Error(d.error || d.detail || `卸载失败(${res.status})`)
      }
      applyStatus(d)
      setShowPkgList(false)
      await endProgress(true)
    } catch (e) {
      setErr(String(e.message || e))
      setProgressMode(null)
      setBusy(false)
    }
  }

  /** 胶囊：启停 JEV */
  async function toggle(next) {
    const prev = st
    setSt({ ...st, enabled: next })
    setBusy(true)
    setProgressMode(next ? 'enable' : 'disable')
    setErr('')
    try {
      const res = await fetch(`${API}/admin/jevos/settings`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: next }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        setSt(prev)
        setProgressMode(null)
        setBusy(false)
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSt(prev)
        throw new Error(d.error || d.detail || `保存失败(${res.status})`)
      }
      applyStatus(d)
      await endProgress(true)
    } catch (e) {
      setSt(prev)
      setErr(String(e.message || e))
      setProgressMode(null)
      setBusy(false)
    }
  }

  const showProgress = !!progressMode
  /** 已装或本机已有健康进程：显示胶囊；否则显示「安装」 */
  const canCapsule = st.installed || st.healthy
  const needInstall = !st.installed

  return (
    <SettingsFold
      title={t('settings.jev')}
      desc={t('settings.jevDesc')}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">
            {st.enabled && st.healthy && !showProgress ? (
              <span className="engine-dot ok" title={t('settings.jev.readyTitle')} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            ) : null}
            {t('settings.jev.resident')}
          </span>
          <p className="ma-capsule-hint">
            {st.detail || t('settings.common.undetected')}
            {st.release_tag ? ` · ${st.release_tag}` : ''}
            {st.cached && st.checked_at ? t('settings.common.cachedAt', { time: st.checked_at }) : ''}
          </p>
          {st.release_url && showPkgList ? (
            <p className="ma-capsule-hint" style={{ marginTop: 6 }}>
              Release：
              <a href={st.release_url} target="_blank" rel="noreferrer">
                {st.release_url}
              </a>
            </p>
          ) : null}
        </div>

        {canCapsule ? (
          <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!st.enabled}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span className="slider" />
          </label>
        ) : (
          <button
            type="button"
            className="gc-meet-btn"
            disabled={busy}
            onClick={() => setShowPkgList(true)}
          >
            {t('settings.common.install')}
          </button>
        )}
      </div>

      {needInstall && showPkgList ? (
        <div className="jev-pkg-list" style={{ marginTop: 12 }}>
          <p className="ma-capsule-hint" style={{ marginBottom: 8 }}>
            {t('settings.jev.pickPkg')}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(st.packages || []).map((p) => (
              <li key={p.id}>
                <label
                  className={`jev-pkg-item${pick === p.id ? ' is-on' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: pick === p.id ? '1px solid var(--accent, #2f65f6)' : '1px solid var(--border, #30363d)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="jev-pkg"
                    checked={pick === p.id}
                    disabled={busy}
                    onChange={() => setPick(p.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    {p.recommended ? <em style={{ marginLeft: 8, opacity: 0.75 }}>{t('settings.common.recommended')}</em> : null}
                    <br />
                    <span className="ma-capsule-hint">{p.size_hint || p.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
		  <label className="jev-mirror-option">
			<input
			  type="checkbox"
			  checked={chinaMirror}
			  disabled={busy}
			  onChange={(e) => setChinaMirror(e.target.checked)}
			/>
			<span>
			  <strong>{t('settings.jev.mirrorTitle')}</strong>
			  <small>{t('settings.jev.mirrorHint')}</small>
			</span>
		  </label>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="gc-meet-btn"
              disabled={busy || !pick}
              onClick={() => void install()}
            >
              {busy && progressMode === 'install' ? t('settings.common.installing') : t('settings.jev.downloadInstall')}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setShowPkgList(false)}>
              {t('settings.common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {showProgress ? (
        <div className="island-boot-progress" aria-live="polite" style={{ marginTop: 12 }}>
          <div className="island-boot-track">
            <div className="island-boot-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="island-boot-label">{progress.label}</p>
		  {progressMode === 'install' && slowInstall ? (
			<p className="jev-slow-hint">
			  {t('settings.jev.slowHint')}
			</p>
		  ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ghost" disabled={busy} onClick={() => void load(true)}>
          {t('settings.common.recheck')}
        </button>
        {st.installed ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => setShowPkgList(true)}
          >
            {t('settings.common.reinstall')}
          </button>
        ) : null}
        {st.can_uninstall || st.installed ? (
          <button
            type="button"
            className="ghost danger-text"
            disabled={busy}
            onClick={() => void uninstall()}
            title={t('settings.jev.uninstallTitle')}
          >
            {busy && progressMode === 'uninstall' ? t('settings.common.uninstalling') : t('settings.common.uninstall')}
          </button>
        ) : null}
      </div>

      {st.installed && showPkgList ? (
        <div className="jev-pkg-list" style={{ marginTop: 12 }}>
          <p className="ma-capsule-hint" style={{ marginBottom: 8 }}>
            {t('settings.jev.pickPkgRe')}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(st.packages || []).map((p) => (
              <li key={p.id}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: pick === p.id ? '1px solid var(--accent, #2f65f6)' : '1px solid var(--border, #30363d)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="jev-pkg-re"
                    checked={pick === p.id}
                    disabled={busy}
                    onChange={() => setPick(p.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    {p.recommended ? <em style={{ marginLeft: 8, opacity: 0.75 }}>{t('settings.common.recommended')}</em> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
		  <label className="jev-mirror-option">
			<input
			  type="checkbox"
			  checked={chinaMirror}
			  disabled={busy}
			  onChange={(e) => setChinaMirror(e.target.checked)}
			/>
			<span>
			  <strong>{t('settings.jev.mirrorTitle')}</strong>
			  <small>{t('settings.jev.mirrorHint')}</small>
			</span>
		  </label>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="gc-meet-btn" disabled={busy || !pick} onClick={() => void install()}>
              {busy && progressMode === 'install' ? t('settings.common.installing') : t('settings.jev.downloadInstall')}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setShowPkgList(false)}>
              {t('settings.common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
		<>
		  <pre className="error" style={{ marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
			{err}
		  </pre>
		  {installFailed ? (
			<button type="button" className="gc-meet-btn" disabled={busy || !pick} onClick={() => void install()}>
			  {t('settings.jev.retryInstall')}
			</button>
		  ) : null}
		</>
      ) : null}
    </SettingsFold>
  )
}
