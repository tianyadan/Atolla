import { useEffect, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

/** Settings · session runtime: reuse SettingsFold + form styles. */
export default function RuntimeSettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
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
      if (!res.ok) throw new Error(data.error || t('settings.runtime.loadFail', { status: res.status }))
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
      if (!res.ok) throw new Error(data.error || t('settings.runtime.saveFail', { status: res.status }))
      setRestartRequired(true)
      setHint(t('settings.runtime.savedHint'))
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
    setHint(t('settings.runtime.savingHint'))
    try {
      const saved = await save()
      if (!saved) return
      setBusy(true)
      setHint(t('settings.runtime.restartingHint'))
      const res = await fetch(`${API}/admin/runtime-settings/restart`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t('settings.runtime.restartFail', { status: res.status }))
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
      title={t('settings.runtime')}
      desc={t('settings.runtimeDesc')}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <div className="github-idea-settings">
        <div className="github-idea-grid">
          <label>
            {t('settings.runtime.idleTtl')}
            <input
              type="number"
              min="0"
              max="3600"
              value={form.idle_ttl_seconds}
              disabled={busy}
              onChange={(event) => setForm((value) => ({ ...value, idle_ttl_seconds: Number(event.target.value) }))}
            />
            <small>{t('settings.runtime.idleTtlHint')}</small>
          </label>
          <label>
            {t('settings.runtime.memLimit')}
            <input
              type="number"
              min="128"
              max="32768"
              step="128"
              value={form.memory_limit_mb}
              disabled={busy}
              onChange={(event) => setForm((value) => ({ ...value, memory_limit_mb: Number(event.target.value) }))}
            />
            <small>{t('settings.runtime.memLimitHint')}</small>
          </label>
        </div>

        <div className="ma-capsule-row">
          <div className="ma-capsule-text">
            <span className="ma-capsule-label">{t('settings.runtime.cliPolicy')}</span>
            <p className="ma-capsule-hint">{t('settings.runtime.cliPolicyHint')}</p>
          </div>
          <span className="db-status-tag">{t('settings.runtime.noAutoUpdate')}</span>
        </div>

        <p className="engine-note">{t('settings.runtime.note')}</p>

        {hint && <p className="engine-note">{hint}</p>}
        {err && <p className="engine-hint">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void save()}>
            {busy ? t('settings.common.saving') : t('settings.runtime.save')}
          </button>
          <button type="button" disabled={busy} onClick={() => void restart()}>
            {busy
              ? t('settings.common.saving')
              : restartRequired
                ? t('settings.runtime.restartNow')
                : t('settings.runtime.saveRestart')}
          </button>
        </div>
      </div>
    </SettingsFold>
  )
}
