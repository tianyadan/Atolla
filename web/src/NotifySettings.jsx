import { useEffect, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

/** 管理台「设置 · 通知」：完成通知与命令审批通知开关；开启前需 Bark 验证码。 */
export default function NotifySettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const [prefs, setPrefs] = useState({
    task_done: false,
    permission: false,
    bark_verified: false,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(true)
  /** 待开启的开关：未验证时点开会进入验码 */
  const [pendingKey, setPendingKey] = useState(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

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
        task_done: !!d.task_done,
        permission: !!d.permission,
        bark_verified: !!d.bark_verified,
      })
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  useEffect(() => {
    if (active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  /** 立即保存一条开关，失败时回滚。 */
  async function savePrefs(next) {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/notify-prefs`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          task_done: next.task_done,
          permission: next.permission,
        }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return null
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `保存失败(${res.status})`)
      const saved = {
        task_done: !!d.task_done,
        permission: !!d.permission,
        bark_verified: !!d.bark_verified,
      }
      setPrefs(saved)
      return saved
    } catch (e) {
      setErr(String(e.message || e))
      return null
    } finally {
      setBusy(false)
    }
  }

  /** 关闭直接保存；开启且未验证则进入验码。 */
  async function toggle(key, next) {
    if (busy || otpBusy) return
    if (!next) {
      const prev = prefs
      const body = { ...prefs, [key]: false }
      setPrefs(body)
      const saved = await savePrefs(body)
      if (!saved) setPrefs(prev)
      return
    }
    if (prefs.bark_verified) {
      const prev = prefs
      const body = { ...prefs, [key]: true }
      setPrefs(body)
      const saved = await savePrefs(body)
      if (!saved) setPrefs(prev)
      return
    }
    setPendingKey(key)
    setOtpCode('')
    setErr('')
  }

  /** 发送 Bark 验证码 */
  async function onSendOtp() {
    if (otpBusy || cooldown > 0) return
    setOtpBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/notify-prefs/verify/send`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `发送失败(${res.status})`)
      setCooldown(60)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setOtpBusy(false)
    }
  }

  /** 校验验证码并开启待定开关 */
  async function onConfirmOtp() {
    if (otpBusy || !/^\d{6}$/.test(otpCode.trim())) {
      setErr('请输入 6 位验证码')
      return
    }
    setOtpBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/notify-prefs/verify/confirm`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ code: otpCode.trim() }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `验证失败(${res.status})`)
      const verified = {
        task_done: !!d.task_done,
        permission: !!d.permission,
        bark_verified: true,
      }
      setPrefs(verified)
      const key = pendingKey
      setPendingKey(null)
      setOtpCode('')
      if (key) {
        const body = { ...verified, [key]: true }
        setPrefs(body)
        const saved = await savePrefs(body)
        if (!saved) setPrefs(verified)
      }
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setOtpBusy(false)
    }
  }

  const showVerify = !!pendingKey && !prefs.bark_verified

  return (
    <SettingsFold
      title={t('settings.notify')}
      desc={t('settings.notifyDesc')}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">{t('settings.notify.taskDone')}</span>
        </div>
        <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
          <input
            type="checkbox"
            checked={!!prefs.task_done}
            disabled={busy || otpBusy}
            onChange={(e) => void toggle('task_done', e.target.checked)}
          />
          <span className="slider" />
        </label>
      </div>
      <div className="ma-capsule-row" style={{ marginTop: 14 }}>
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">{t('settings.notify.permission')}</span>
        </div>
        <label className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
          <input
            type="checkbox"
            checked={!!prefs.permission}
            disabled={busy || otpBusy}
            onChange={(e) => void toggle('permission', e.target.checked)}
          />
          <span className="slider" />
        </label>
      </div>

      {showVerify ? (
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t('settings.notify.code')}
            value={otpCode}
            disabled={otpBusy}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ width: 96, padding: '8px 10px', borderRadius: 8 }}
          />
          <button
            type="button"
            className="btn outline"
            disabled={otpBusy || cooldown > 0}
            onClick={() => void onSendOtp()}
          >
            {cooldown > 0 ? `${cooldown}s` : t('settings.notify.send')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={otpBusy || otpCode.length !== 6}
            onClick={() => void onConfirmOtp()}
          >
            {t('settings.notify.confirm')}
          </button>
          <button
            type="button"
            className="btn outline"
            disabled={otpBusy}
            onClick={() => {
              setPendingKey(null)
              setOtpCode('')
              setErr('')
            }}
          >
            {t('settings.notify.cancel')}
          </button>
        </div>
      ) : null}

      {err ? (
        <pre className="error" style={{ marginTop: 12 }}>
          {err}
        </pre>
      ) : null}
    </SettingsFold>
  )
}
