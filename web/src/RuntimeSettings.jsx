import { useEffect, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'

const API = '/api'

/** 设置 · 会话运行时：沿用现有 SettingsFold 与表单样式。 */
export default function RuntimeSettings({ authHeaders, onUnauthorized, active }) {
  const [open, setOpen] = useState(true)
  const [form, setForm] = useState({ idle_ttl_seconds: 60, memory_limit_mb: 2048 })
  const [busy, setBusy] = useState(false)
  const [restartRequired, setRestartRequired] = useState(false)
  const [hint, setHint] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    setErr('')
    try {
      const res = await fetch(`${API}/admin/runtime-settings`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `运行时配置加载失败(${res.status})`)
      setForm({
        idle_ttl_seconds: Number(data.idle_ttl_seconds) || 0,
        memory_limit_mb: Number(data.memory_limit_mb) || 2048,
      })
      setRestartRequired(false)
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  async function save() {
    setBusy(true)
    setErr('')
    setHint('')
    try {
      const res = await fetch(`${API}/admin/runtime-settings`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(form),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return false
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `保存失败(${res.status})`)
      setRestartRequired(true)
      setHint('配置已保存，重启后生效。')
      return true
    } catch (e) {
      setErr(String(e.message || e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function restart() {
    setBusy(true)
    setErr('')
    setHint('正在保存配置…')
    try {
      const saved = await save()
      if (!saved) return
      setBusy(true)
      setHint('正在重启 Atolla…')
      const res = await fetch(`${API}/admin/runtime-settings/restart`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `重启失败(${res.status})`)
      setTimeout(() => window.location.reload(), 3500)
    } catch (e) {
      setErr(String(e.message || e))
      setHint('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsFold
      title="会话运行时"
      desc="短时保留支持持续协议的会话进程，统一缓存版本与连接检查；CLI 自动更新已禁用"
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <div className="github-idea-settings">
        <div className="github-idea-grid">
          <label>
            空闲保温时长（秒）
            <input
              type="number"
              min="0"
              max="3600"
              value={form.idle_ttl_seconds}
              disabled={busy}
              onChange={(event) => setForm((value) => ({ ...value, idle_ttl_seconds: Number(event.target.value) }))}
            />
            <small>默认 60；填 0 可关闭进程保温。</small>
          </label>
          <label>
            空闲进程内存阈值（MB）
            <input
              type="number"
              min="128"
              max="32768"
              step="128"
              value={form.memory_limit_mb}
              disabled={busy}
              onChange={(event) => setForm((value) => ({ ...value, memory_limit_mb: Number(event.target.value) }))}
            />
            <small>默认 2048；达到阈值会释放全部空闲保温进程。</small>
          </label>
        </div>

        <div className="ma-capsule-row">
          <div className="ma-capsule-text">
            <span className="ma-capsule-label">CLI 版本策略</span>
            <p className="ma-capsule-hint">版本锁定，子进程禁止自动更新；版本与连接健康检查由平台缓存 5 分钟。</p>
          </div>
          <span className="db-status-tag">禁止自动更新</span>
        </div>

        <p className="engine-note">
          Claude 使用持续流进程复用；Codex 与 Cursor 当前保持安全冷启动并复用会话 ID，避免用不可持续的一次性进程伪装保温。
        </p>

        {hint && <p className="engine-note">{hint}</p>}
        {err && <p className="engine-hint">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void save()}>
            {busy ? '处理中…' : '保存配置'}
          </button>
          <button type="button" disabled={busy} onClick={() => void restart()}>
            {busy ? '处理中…' : (restartRequired ? '立即重启生效' : '保存并重启')}
          </button>
        </div>
      </div>
    </SettingsFold>
  )
}
