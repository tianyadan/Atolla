import { useEffect, useRef, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

const EMPTY_STEPS = []

/** Progress step labels for Dynamic Island actions */
function islandSteps(t, mode) {
  switch (mode) {
    case 'enable':
      return [
        t('settings.island.step.configure'),
        t('settings.island.step.register'),
        t('settings.island.step.wake'),
        t('settings.island.step.almost'),
      ]
    case 'install':
      return [
        t('settings.island.step.fetchRelease'),
        t('settings.island.step.download'),
        t('settings.island.step.extract'),
        t('settings.island.step.register'),
        t('settings.island.step.start'),
        t('settings.island.step.almost'),
      ]
    case 'update':
      return [
        t('settings.island.step.detect'),
        t('settings.island.step.downloadUpdate'),
        t('settings.island.step.replace'),
        t('settings.island.step.restart'),
        t('settings.island.step.almost'),
      ]
    case 'disable':
      return [t('settings.island.step.disable'), t('settings.island.step.almost')]
    case 'uninstall':
      return [
        t('settings.island.step.stop'),
        t('settings.island.step.cleanup'),
        t('settings.island.step.almost'),
      ]
    default:
      return EMPTY_STEPS
  }
}

/**
 * Fake staged progress while waiting on a backend call with no real stream.
 */
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
    setPct(8)
    timerRef.current = window.setInterval(() => {
      stepRef.current = Math.min(steps.length - 1, stepRef.current + 1)
      setLabel(steps[stepRef.current])
      setPct((p) => {
        const cap = 92
        const next = p + (cap - p) * 0.18 + 3
        return Math.min(cap, Math.round(next))
      })
    }, 1600)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = 0
    }
  }, [active, steps])

  /** Snap progress to 100% when the request finishes */
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

/** 压成一行短报错 */
function shortErr(msg) {
  const s = String(msg || '').trim().split('\n')[0].trim()
  if (s.length <= 120) return s
  return `${s.slice(0, 120)}…`
}

/** 设置 · 灵动岛：未安装点「安装」自动拉最新 Release；已安装可开关或卸载。 */
export default function IslandSettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progressMode, setProgressMode] = useState(null) // enable|install|disable|uninstall
  const [err, setErr] = useState('')
  const [st, setSt] = useState({
    installed: false,
    enabled: false,
    detail: '',
    cached: false,
    checked_at: '',
    release_tag: '',
    release_url: '',
    binary_path: '',
    installed_tag: '',
    update_available: false,
  })

  const stepList = islandSteps(t, progressMode)
  const progress = useStagedProgress(!!progressMode, stepList, t('settings.common.done'))

  function applyStatus(d) {
    setSt({
      installed: !!d.installed,
      enabled: !!d.enabled,
      detail: d.detail || '',
      cached: !!d.cached,
      checked_at: d.checked_at || '',
      release_tag: d.release_tag || '',
      release_url: d.release_url || '',
      binary_path: d.binary_path || '',
      installed_tag: d.installed_tag || '',
      update_available: !!d.update_available,
    })
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
      const res = await fetch(`${API}/admin/island/settings${q}`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || d.detail || `加载失败(${res.status})`)
      applyStatus(d)
    } catch (e) {
      setErr(shortErr(e.message || e))
    }
  }

  const busyRef = useRef(false)
  busyRef.current = busy

  // 进入设置时强制检测最新 Release；之后每 10 分钟自动再检一次
  useEffect(() => {
    if (!active) return undefined
    void load(true)
    const timer = window.setInterval(() => {
      if (!busyRef.current) void load(true)
    }, 10 * 60 * 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 一键安装 / 更新：后端拉最新 GitHub Release 并常驻 */
  async function install(asUpdate = false) {
    setBusy(true)
    setProgressMode(asUpdate ? 'update' : 'install')
    setErr('')
    try {
      const res = await fetch(`${API}/admin/island/settings/install`, {
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
        throw new Error(d.error || d.detail || `${asUpdate ? '更新' : '安装'}失败(${res.status})`)
      }
      applyStatus(d)
      await endProgress(true)
    } catch (e) {
      setErr(shortErr(e.message || e))
      setProgressMode(null)
      setBusy(false)
    }
  }

  /** 完全卸载并清理本机文件 */
  async function uninstall() {
    if (!window.confirm(t('settings.island.confirmUninstall'))) return
    setBusy(true)
    setProgressMode('uninstall')
    setErr('')
    try {
      const res = await fetch(`${API}/admin/island/settings`, {
        method: 'DELETE',
        headers: authHeaders(),
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
      await endProgress(true)
    } catch (e) {
      setErr(shortErr(e.message || e))
      setProgressMode(null)
      setBusy(false)
    }
  }

  /** 胶囊开关：启停常驻（已安装后） */
  async function toggle(next) {
    const prev = st
    setSt({ ...st, enabled: next })
    setBusy(true)
    setProgressMode(next ? 'enable' : 'disable')
    setErr('')
    try {
      const res = await fetch(`${API}/admin/island/settings`, {
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
      setErr(shortErr(e.message || e))
      setProgressMode(null)
      setBusy(false)
    }
  }

  const needInstall = !st.installed
  const showProgress = !!progressMode

  return (
    <SettingsFold
      title={t('settings.island')}
      desc={t('settings.islandDesc')}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">
            {st.installed && st.enabled && !showProgress ? (
              <span className="engine-dot ok" title={t('settings.island.runningTitle')} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            ) : null}
            {t('settings.island.resident')}
          </span>
          <p className="ma-capsule-hint">
            {st.detail || t('settings.common.undetected')}
            {st.installed_tag && st.release_tag && st.installed_tag !== st.release_tag
              ? t('settings.island.latest', { tag: st.release_tag })
              : st.release_tag && !st.installed_tag
                ? t('settings.island.latest', { tag: st.release_tag })
                : ''}
            {st.cached && st.checked_at ? t('settings.common.cachedAt', { time: st.checked_at }) : ''}
          </p>
        </div>

        {needInstall ? (
          <button
            type="button"
            className="gc-meet-btn"
            disabled={busy}
            onClick={() => void install(false)}
            title={t('settings.island.installTitle')}
          >
            {busy && progressMode === 'install' ? t('settings.common.installing') : t('settings.common.install')}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {st.update_available ? (
              <button
                type="button"
                className="gc-meet-btn"
                disabled={busy}
                onClick={() => void install(true)}
                title={st.release_tag ? t('settings.island.updateTo', { tag: st.release_tag }) : t('settings.island.updateLatest')}
              >
                {busy && progressMode === 'update' ? t('settings.common.updating') : t('settings.common.update')}
              </button>
            ) : null}
            <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
              <input
                type="checkbox"
                checked={!!st.enabled}
                disabled={busy}
                onChange={(e) => void toggle(e.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>
        )}
      </div>

      {showProgress ? (
        <div className="island-boot-progress" aria-live="polite">
          <div className="island-boot-track">
            <div className="island-boot-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="island-boot-label">{progress.label}</p>
        </div>
      ) : null}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ghost" disabled={busy} onClick={() => void load(true)}>
          {t('settings.common.recheck')}
        </button>
        {st.installed ? (
          <>
            <button type="button" className="ghost" disabled={busy} onClick={() => void install(false)}>
              {t('settings.common.reinstall')}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void uninstall()}>
              {t('settings.common.uninstall')}
            </button>
          </>
        ) : null}
        {st.release_url ? (
          <a
            className="ghost"
            href={st.release_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
          >
            Release
          </a>
        ) : null}
      </div>

      {err ? (
        <p className="error" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.4 }}>
          {err}
        </p>
      ) : null}
    </SettingsFold>
  )
}
