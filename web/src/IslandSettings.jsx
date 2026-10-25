import { useEffect, useRef, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'

const API = '/api'

/** 开启时常驻文案 */
const ENABLE_STEPS = [
  '正在配置灵动岛…',
  '正在注册 LaunchAgent…',
  '正在唤醒顶部常驻…',
  '即将完成…',
]

/** 从 GitHub Release 一键安装 */
const INSTALL_STEPS = [
  '正在获取最新 GitHub Release…',
  '正在下载灵动岛组件…',
  '正在解压并写入本机…',
  '正在注册 LaunchAgent…',
  '正在启动灵动岛…',
  '即将完成…',
]

const DISABLE_STEPS = [
  '正在关闭灵动岛常驻…',
  '即将完成…',
]

const UNINSTALL_STEPS = [
  '正在停止灵动岛…',
  '正在清理本机组件…',
  '即将完成…',
]

const EMPTY_STEPS = []

/**
 * 后端无真实进度流时：用定时文案 + 缓增进度条改善等待体验；
 * 请求结束后拉到 100% 再收起。
 */
function useStagedProgress(active, steps) {
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

  /** 请求结束：进度拉满 */
  function finish() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = 0
    }
    setPct(100)
    setLabel('完成')
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
  })

  const stepList =
    progressMode === 'install'
      ? INSTALL_STEPS
      : progressMode === 'uninstall'
        ? UNINSTALL_STEPS
        : progressMode === 'disable'
          ? DISABLE_STEPS
          : progressMode === 'enable'
            ? ENABLE_STEPS
            : EMPTY_STEPS
  const progress = useStagedProgress(!!progressMode, stepList)

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

  useEffect(() => {
    if (active) void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 一键安装：后端拉最新 GitHub Release 并常驻 */
  async function install() {
    setBusy(true)
    setProgressMode('install')
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
        throw new Error(d.error || d.detail || `安装失败(${res.status})`)
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
    if (!window.confirm('确定卸载灵动岛？将停止常驻并删除本机组件。')) return
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
      title="灵动岛"
      desc="macOS 顶部展示运行中数字人；首次安装自动拉取最新 GitHub Release"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">
            {st.installed && st.enabled && !showProgress ? (
              <span className="engine-dot ok" title="灵动岛运行中" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            ) : null}
            灵动岛常驻
          </span>
          <p className="ma-capsule-hint">
            {st.detail || '未检测'}
            {st.release_tag ? ` · ${st.release_tag}` : ''}
            {st.cached && st.checked_at ? `（缓存于 ${st.checked_at}）` : ''}
          </p>
        </div>

        {needInstall ? (
          <button
            type="button"
            className="gc-meet-btn"
            disabled={busy}
            onClick={() => void install()}
            title="从 GitHub 最新 Release 自动下载并安装"
          >
            {busy && progressMode === 'install' ? '安装中…' : '安装'}
          </button>
        ) : (
          <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!st.enabled}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span className="slider" />
          </label>
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
          重新检测
        </button>
        {st.installed ? (
          <>
            <button type="button" className="ghost" disabled={busy} onClick={() => void install()}>
              重新安装
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void uninstall()}>
              卸载
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
