import { useEffect, useState } from 'react'

const API = '/api'

/** 管理台「设置 · 通知」：完成通知与命令审批通知开关。 */
export default function NotifySettings({ authHeaders, onUnauthorized, active }) {
  const [prefs, setPrefs] = useState({ task_done: true, permission: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setErr('')
    try {
      const res = await fetch(`${API}/admin/notify-prefs`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `加载失败(${res.status})`)
      setPrefs({
        task_done: d.task_done !== false,
        permission: d.permission !== false,
      })
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /** 立即保存一条开关，失败时回滚。 */
  async function toggle(key, next) {
    const prev = prefs
    const body = { ...prefs, [key]: next }
    setPrefs(body)
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/notify-prefs`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        setPrefs(prev)
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `保存失败(${res.status})`)
      setPrefs({
        task_done: d.task_done !== false,
        permission: d.permission !== false,
      })
    } catch (e) {
      setPrefs(prev)
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="list rr-panel">
      <div className="lm-shelf-head">
        <div>
          <h2>设置</h2>
          <p className="empty-hint">离开数字人对话后，Bark 是否推送到手机。</p>
        </div>
      </div>
      <article className="version-card settings-notify-card">
        <div className="version-head">
          <span className="version-tag">通知</span>
        </div>
        <div className="ma-capsule-row">
          <div className="ma-capsule-text">
            <span className="ma-capsule-label">完成通知</span>
            <p className="ma-capsule-hint">任务结束且两端都没打开该对话时，推送「任务已完成」。</p>
          </div>
          <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!prefs.task_done}
              disabled={busy}
              onChange={(e) => void toggle('task_done', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>
        <div className="ma-capsule-row" style={{ marginTop: 14 }}>
          <div className="ma-capsule-text">
            <span className="ma-capsule-label">命令审批通知</span>
            <p className="ma-capsule-hint">有命令等待人工审批、且两端都没打开该对话时推送。</p>
          </div>
          <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!prefs.permission}
              disabled={busy}
              onChange={(e) => void toggle('permission', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>
        {err && <pre className="error" style={{ marginTop: 12 }}>{err}</pre>}
      </article>
    </section>
  )
}
