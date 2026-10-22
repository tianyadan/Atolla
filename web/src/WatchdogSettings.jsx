import { useEffect, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'

const API = '/api'
const DEPLOY_HOST_HISTORY_KEY = 'atolla_relay_deploy_hosts'

/** 读取远程中继页记过的主机，作默认填入 */
function guessDeployHost() {
  try {
    const arr = JSON.parse(localStorage.getItem(DEPLOY_HOST_HISTORY_KEY) || '[]')
    if (Array.isArray(arr) && arr[0]) return String(arr[0]).trim()
  } catch {
    /* ignore */
  }
  return ''
}

/** 设置 · 后台守护：本机后端 / 移动端中继 两个独立胶囊开关 */
export default function WatchdogSettings({ authHeaders, onUnauthorized, active }) {
  const [open, setOpen] = useState(true)
  const [busyLocal, setBusyLocal] = useState(false)
  const [busyRelay, setBusyRelay] = useState(false)
  const [err, setErr] = useState('')
  const [local, setLocal] = useState({ enabled: false, status: 'unknown', detail: '', grace_sec: 180 })
  const [relay, setRelay] = useState({
    enabled: false,
    status: 'unknown',
    detail: '',
    grace_sec: 300,
    host: '',
    user: 'root',
    ssh_port: 22,
    remote_dir: '/opt/atolla-remote-relay',
    listen_port: 3080,
  })
  const [sshPassword, setSshPassword] = useState('')
  const [showRelayForm, setShowRelayForm] = useState(false)

  /** 拉取两端状态（互不合并） */
  async function load() {
    setErr('')
    try {
      const [lr, rr] = await Promise.all([
        fetch(`${API}/admin/watchdog/local`, { headers: authHeaders() }),
        fetch(`${API}/admin/watchdog/relay`, { headers: authHeaders() }),
      ])
      if (lr.status === 401 || rr.status === 401) {
        onUnauthorized?.()
        return
      }
      const ld = await lr.json().catch(() => ({}))
      const rd = await rr.json().catch(() => ({}))
      if (!lr.ok) throw new Error(ld.error || `本机状态失败(${lr.status})`)
      setLocal({
        enabled: !!ld.enabled,
        status: ld.status || 'unknown',
        detail: ld.detail || '',
        grace_sec: Number(ld.grace_sec) || 180,
      })
      setRelay((prev) => ({
        ...prev,
        enabled: !!rd.enabled,
        status: rd.status || 'unknown',
        detail: rd.detail || '',
        grace_sec: Number(rd.grace_sec) || 300,
        host: rd.host || prev.host || guessDeployHost(),
        user: rd.user || prev.user || 'root',
        ssh_port: Number(rd.ssh_port) || prev.ssh_port || 22,
        remote_dir: rd.remote_dir || prev.remote_dir || '/opt/atolla-remote-relay',
        listen_port: Number(rd.listen_port) || prev.listen_port || 3080,
      }))
      if (!rd.host && !guessDeployHost()) setShowRelayForm(true)
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 切换本机 LaunchAgent 守护 */
  async function toggleLocal(next) {
    const prev = local
    setLocal({ ...local, enabled: next })
    setBusyLocal(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/watchdog/local`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: next }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        setLocal(prev)
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || d.detail || `保存失败(${res.status})`)
      setLocal({
        enabled: !!d.enabled,
        status: d.status || 'unknown',
        detail: d.detail || '',
        grace_sec: Number(d.grace_sec) || 180,
      })
    } catch (e) {
      setLocal(prev)
      setErr(String(e.message || e))
    } finally {
      setBusyLocal(false)
    }
  }

  /** 切换远端中继 systemd timer 守护 */
  async function toggleRelay(next) {
    if (next && !String(relay.host || '').trim()) {
      setShowRelayForm(true)
      setErr('请先填写移动端部署主机')
      return
    }
    const prev = relay
    setRelay({ ...relay, enabled: next })
    setBusyRelay(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/watchdog/relay`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          enabled: next,
          host: relay.host.trim(),
          user: relay.user.trim() || 'root',
          ssh_port: Number(relay.ssh_port) || 22,
          remote_dir: relay.remote_dir.trim() || '/opt/atolla-remote-relay',
          listen_port: Number(relay.listen_port) || 3080,
          ssh_password: sshPassword,
        }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        setRelay(prev)
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = [d.detail, d.error].filter(Boolean).join('\n')
        throw new Error(reason || `保存失败(${res.status})`)
      }
      setRelay((p) => ({
        ...p,
        enabled: !!d.enabled,
        status: d.status || 'unknown',
        detail: d.detail || '',
        grace_sec: Number(d.grace_sec) || 300,
        host: d.host || p.host,
        user: d.user || p.user,
        ssh_port: Number(d.ssh_port) || p.ssh_port,
        remote_dir: d.remote_dir || p.remote_dir,
        listen_port: Number(d.listen_port) || p.listen_port,
      }))
      if (d.status === 'error') {
        setErr(d.detail || d.error || '中继守护状态异常')
      } else {
        setSshPassword('')
      }
    } catch (e) {
      setRelay(prev)
      setErr(String(e.message || e))
    } finally {
      setBusyRelay(false)
    }
  }

  return (
    <SettingsFold
      title="后台守护"
      desc="防止意外退出：本机与移动端中继分开开关，宽限期避免更新重启叠进程"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">
            {local.enabled && local.status === 'active' ? (
              <span className="engine-dot ok" title="守护运行中" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            ) : null}
            本机后端守护
          </span>
          <p className="ma-capsule-hint">
            macOS LaunchAgent，约 60s 探测 /health；连续不健康满 {local.grace_sec || 180}s 才拉起 Go 后端。
            {local.detail ? ` 当前：${local.detail}` : ''}
          </p>
        </div>
        <label className={`auto-switch ma-capsule ${busyLocal ? 'busy' : ''}`}>
          <input
            type="checkbox"
            checked={!!local.enabled}
            disabled={busyLocal}
            onChange={(e) => void toggleLocal(e.target.checked)}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="ma-capsule-row" style={{ marginTop: 14 }}>
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">
            {relay.enabled && relay.status === 'active' ? (
              <span className="engine-dot ok" title="守护运行中" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            ) : null}
            移动端中继守护
          </span>
          <p className="ma-capsule-hint">
            远端 systemd timer，约 60s 探测 /api/health；连续不健康满 {relay.grace_sec || 300}s 才 restart 中继。
            {relay.detail ? ` 当前：${relay.detail}` : ''}
          </p>
        </div>
        <label className={`auto-switch ma-capsule ${busyRelay ? 'busy' : ''}`}>
          <input
            type="checkbox"
            checked={!!relay.enabled}
            disabled={busyRelay}
            onChange={(e) => void toggleRelay(e.target.checked)}
          />
          <span className="slider" />
        </label>
      </div>

      <button
        type="button"
        className="ghost"
        style={{ marginTop: 12 }}
        onClick={() => setShowRelayForm((v) => !v)}
      >
        {showRelayForm ? '收起中继 SSH 参数' : '中继 SSH 参数'}
      </button>

      {showRelayForm ? (
        <div className="watchdog-relay-form" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <label className="ma-capsule-hint">
            主机
            <input
              className="ma-search"
              style={{ marginTop: 4, marginBottom: 0 }}
              value={relay.host}
              onChange={(e) => setRelay({ ...relay, host: e.target.value })}
              placeholder="例如 1.2.3.4"
            />
          </label>
          <label className="ma-capsule-hint">
            SSH 用户
            <input
              className="ma-search"
              style={{ marginTop: 4, marginBottom: 0 }}
              value={relay.user}
              onChange={(e) => setRelay({ ...relay, user: e.target.value })}
            />
          </label>
          <label className="ma-capsule-hint">
            SSH 端口
            <input
              className="ma-search"
              style={{ marginTop: 4, marginBottom: 0 }}
              type="number"
              value={relay.ssh_port}
              onChange={(e) => setRelay({ ...relay, ssh_port: Number(e.target.value) || 22 })}
            />
          </label>
          <label className="ma-capsule-hint">
            远端目录
            <input
              className="ma-search"
              style={{ marginTop: 4, marginBottom: 0 }}
              value={relay.remote_dir}
              onChange={(e) => setRelay({ ...relay, remote_dir: e.target.value })}
            />
          </label>
          <label className="ma-capsule-hint">
            SSH 密码（可选；有密钥可留空，开/关时使用，不落盘）
            <input
              className="ma-search"
              style={{ marginTop: 4, marginBottom: 0 }}
              type="password"
              autoComplete="new-password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      {err ? (
        <pre className="error" style={{ marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
          {err}
        </pre>
      ) : null}
    </SettingsFold>
  )
}
