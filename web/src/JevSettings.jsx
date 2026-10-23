import { useEffect, useRef, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'

const API = '/api'

const INSTALL_STEPS = [
  '正在连接 GitHub Release…',
  '正在下载运行时（约 20MB）…',
  '正在下载模型（约 600MB，请耐心等待）…',
  '正在解压并写入 ~/.atolla/jevos…',
  '即将完成…',
]

const ENABLE_STEPS = [
  '正在注册 LaunchAgent…',
  '正在启动 jev serve…',
  '正在等待 /health 就绪…',
  '即将完成…',
]

const DISABLE_STEPS = ['正在关闭 JEV 常驻…', '即将完成…']
const EMPTY_STEPS = []

/** 后端无真实进度流时：定时文案 + 缓增进度条 */
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
    setLabel('完成')
  }

  return { pct, label, finish }
}

/**
 * 设置 · JEV：检测本机 → 未安装则选 GitHub Release 包安装 → 胶囊启停。
 * 开启是数字人「AI 自动审核」的前置条件。
 */
export default function JevSettings({ authHeaders, onUnauthorized, active }) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progressMode, setProgressMode] = useState(null)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
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
      setErr('请先选择安装包')
      return
    }
    setBusy(true)
    setProgressMode('install')
    setErr('')
    try {
      const res = await fetch(`${API}/admin/jevos/settings/install`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ package_id: pick }),
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
      title="JEV"
      desc="本地 AI 风险审核引擎（jevos）；开启后数字人才可使用「自动审核」。包来自 GitHub feder-cr/jev"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">
            {st.enabled && st.healthy && !showProgress ? (
              <span className="engine-dot ok" title="JEV 就绪" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            ) : null}
            JEV 常驻
          </span>
          <p className="ma-capsule-hint">
            {st.detail || '未检测'}
            {st.release_tag ? ` · ${st.release_tag}` : ''}
            {st.cached && st.checked_at ? `（缓存于 ${st.checked_at}）` : ''}
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
            安装
          </button>
        )}
      </div>

      {needInstall && showPkgList ? (
        <div className="jev-pkg-list" style={{ marginTop: 12 }}>
          <p className="ma-capsule-hint" style={{ marginBottom: 8 }}>
            选择平台安装包（将下载运行时 + OpenVINO 模型，约 620MB）：
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
                    {p.recommended ? <em style={{ marginLeft: 8, opacity: 0.75 }}>推荐</em> : null}
                    <br />
                    <span className="ma-capsule-hint">{p.size_hint || p.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="gc-meet-btn"
              disabled={busy || !pick}
              onClick={() => void install()}
            >
              {busy && progressMode === 'install' ? '安装中…' : '下载并安装'}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setShowPkgList(false)}>
              取消
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
        </div>
      ) : null}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ghost" disabled={busy} onClick={() => void load(true)}>
          重新检测
        </button>
        {st.installed ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => setShowPkgList(true)}
          >
            重新安装
          </button>
        ) : null}
      </div>

      {st.installed && showPkgList ? (
        <div className="jev-pkg-list" style={{ marginTop: 12 }}>
          <p className="ma-capsule-hint" style={{ marginBottom: 8 }}>
            选择平台包以重新安装：
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
                    {p.recommended ? <em style={{ marginLeft: 8, opacity: 0.75 }}>推荐</em> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="gc-meet-btn" disabled={busy || !pick} onClick={() => void install()}>
              {busy && progressMode === 'install' ? '安装中…' : '下载并安装'}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setShowPkgList(false)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <pre className="error" style={{ marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
          {err}
        </pre>
      ) : null}
    </SettingsFold>
  )
}
