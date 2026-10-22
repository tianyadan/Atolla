import { useEffect, useRef, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'

const API = '/api'

/** 开启/安装时轮播的固定文案（浅色小字） */
const ENABLE_STEPS = [
  '正在配置灵动岛设置…',
  '正在校验本机 LaunchAgent…',
  '正在加载灵动岛组件…',
  '正在唤醒顶部常驻进程…',
  '即将完成，请稍候…',
]

const INSTALL_STEPS = [
  '正在检查 Xcode 与源码目录…',
  '正在编译灵动岛（首次可能较久）…',
  '正在写入本机二进制…',
  '正在注册 LaunchAgent 常驻…',
  '正在启动灵动岛组件…',
  '即将完成，请稍候…',
]

const DISABLE_STEPS = [
  '正在关闭灵动岛常驻…',
  '正在卸载 LaunchAgent…',
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
        // 缓增，最高卡在 92%，等真实请求结束再封顶
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

  return { pct, label, finish, setPct, setLabel }
}

/** 设置 · 灵动岛：首次「安装」，之后胶囊开关；检测结果走后端缓存。 */
export default function IslandSettings({ authHeaders, onUnauthorized, active }) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progressMode, setProgressMode] = useState(null) // 'enable' | 'install' | 'disable' | null
  const [err, setErr] = useState('')
  const [st, setSt] = useState({
    installed: false,
    enabled: false,
    has_source: false,
    has_xcode: false,
    detail: '',
    cached: false,
    checked_at: '',
    repo_hint: 'macos/AtollaIsland',
    source_path: '',
  })

  const stepList =
    progressMode === 'install'
      ? INSTALL_STEPS
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
      has_source: !!d.has_source,
      has_xcode: !!d.has_xcode,
      detail: d.detail || '',
      cached: !!d.cached,
      checked_at: d.checked_at || '',
      repo_hint: d.repo_hint || 'macos/AtollaIsland',
      source_path: d.source_path || '',
      xcode_detail: d.xcode_detail || '',
      binary_path: d.binary_path || '',
    })
  }

  /** 收起进度条（稍留完成态） */
  async function endProgress(ok) {
    if (ok) progress.finish()
    await new Promise((r) => setTimeout(r, ok ? 420 : 0))
    setProgressMode(null)
    setBusy(false)
  }

  /** 拉取状态；force=true 绕过缓存重检环境 */
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
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 首次安装：编译源码 + 注册 LaunchAgent */
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
      setErr(String(e.message || e))
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
      setErr(String(e.message || e))
      setProgressMode(null)
      setBusy(false)
    }
  }

  const needInstall = !st.installed
  const canInstall = st.has_source && st.has_xcode
  const showProgress = !!progressMode

  return (
    <SettingsFold
      title="灵动岛"
      desc="macOS 顶部展示运行中数字人；可选组件，源码在 macos/AtollaIsland"
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
            {st.cached && st.checked_at ? `（缓存于 ${st.checked_at}）` : ''}
          </p>
          {!st.has_source ? (
            <p className="ma-capsule-hint" style={{ marginTop: 6 }}>
              缺少源码目录 <code>{st.repo_hint || 'macos/AtollaIsland'}</code>
              。可从本仓库拷贝该目录（纯源码、可单独提交 GitHub），放到 Atolla 的 macos/ 下后再安装。
            </p>
          ) : null}
          {st.has_source && !st.has_xcode ? (
            <p className="ma-capsule-hint" style={{ marginTop: 6 }}>
              请先安装完整 Xcode（App Store），仅 Command Line Tools 无法编译。
            </p>
          ) : null}
        </div>

        {needInstall ? (
          <button
            type="button"
            className="gc-meet-btn"
            disabled={busy || !canInstall}
            onClick={() => void install()}
            title={!canInstall ? '请先满足源码与 Xcode 条件' : '编译并安装 LaunchAgent'}
          >
            {busy ? '安装中…' : '安装'}
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
        {st.installed && !st.enabled ? (
          <button type="button" className="ghost" disabled={busy} onClick={() => void install()}>
            重新安装
          </button>
        ) : null}
      </div>

      {err ? (
        <pre className="error" style={{ marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
          {err}
        </pre>
      ) : null}
    </SettingsFold>
  )
}
