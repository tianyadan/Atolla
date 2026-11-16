import { Capacitor } from '@capacitor/core'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, getToken, hasUnlockToken, login } from '../api'
import { scanNativeLanPairingQRCode } from '../nativeCredentials'
import { GlobeIcon, ScanLineIcon } from '../components/ConnectionEntryIcons'
import { getApiBase, setApiBase } from '../utils/apiBase'
import { hasAuthenticatedConnection, hasLanInstanceAccess, startLanConnectionSession } from '../utils/connectionSession'
import { checkLanConnection, completeLanPairing } from '../utils/lanConnection'
import {
  loadPendingDeepLink,
  navigateToDeepLinkChat,
} from '../utils/deepLink'

/** 已登录时的落地：有待处理深链则进目标对话，否则交给首页恢复最近对话。 */
function resumeAfterAuth(navigate: ReturnType<typeof useNavigate>): void {
  const target = loadPendingDeepLink()
  if (!target) {
    navigate('/', { replace: true })
    return
  }
  if (!hasUnlockToken(target.instanceId) && !hasLanInstanceAccess(target.instanceId)) {
    navigate(`/instances?unlock=${encodeURIComponent(target.instanceId)}`, { replace: true })
    return
  }
  navigateToDeepLinkChat(navigate, target, {
    pathname: window.location.pathname,
    search: window.location.search,
  })
}

/** Site gate — branded home / sign-in */
export function LoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectionMode, setConnectionMode] = useState<'choose' | 'remote'>('choose')
  const [lanStatus, setLanStatus] = useState<string | null>(null)
  const native = Capacitor.isNativePlatform()
  const [apiBaseDraft, setApiBaseDraft] = useState(() => getApiBase())
  const authed = hasAuthenticatedConnection(getToken())

  useEffect(() => {
    if (authed) resumeAfterAuth(navigate)
  }, [authed, navigate])

  /** Submit site password */
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (native) {
      setApiBase(apiBaseDraft)
      if (!getApiBase()) {
        setError('Please enter the relay API URL first.')
        return
      }
    }
    setLoading(true)
    try {
      await login(password.trim())
      resumeAfterAuth(navigate)
    } catch (err) {
      clearToken()
      const raw = err instanceof Error ? err.message : 'Sign-in failed'
      // Keep this page English even if the API returns Chinese copy.
      setError(
        raw.includes('账号') || raw.includes('密码')
          ? 'Incorrect site password'
          : raw,
      )
    } finally {
      setLoading(false)
    }
  }

  /** QR contains an instance-scoped pairing challenge; no relay password is required. */
  async function onLanConnect() {
    setError(null)
    setLanStatus('正在打开相机…')
    setLoading(true)
    try {
      const rawPayload = await scanNativeLanPairingQRCode()
      if (!rawPayload) {
        setLanStatus(null)
        return
      }
      setLanStatus('正在安全配对…')
      // First local onboarding must not silently call a remote relay that the
      // user has not configured. They can opt into auto fallback in Settings.
      const paired = await completeLanPairing(rawPayload, 'lan_only')
      setLanStatus('正在进入已配对的 Mac…')
      // A successful pairing response already proves the QR-bound Mac was
      // reachable. Health is diagnostics only: making a second HTTP request a
      // hard gate stranded first-time users during Wi-Fi route transitions.
      void checkLanConnection(paired).catch((healthError) => {
        console.warn('[lan-onboarding] post-pair health check failed', healthError)
      })
      startLanConnectionSession(paired.instanceId || '')
      navigate(`/instances/${encodeURIComponent(paired.instanceId || '')}`, { replace: true })
    } catch (err) {
      const raw = err instanceof Error ? err.message : '局域网连接失败'
      setError(raw)
      setLanStatus(null)
    } finally {
      setLoading(false)
    }
  }

  if (authed) return null

  return (
    <div className="page page-center login-home">
      <div className="login-brand">
        {/* 暗色登录页用白色透明水母，无圆角底框 */}
        <img
          className="login-logo"
          src="/brand-jellyfish-white.png"
          alt=""
          width={88}
          height={88}
          draggable={false}
        />
        <h1 className="login-product">Atolla</h1>
        <p className="login-tagline">Remote Relay</p>
      </div>

      {connectionMode === 'choose' ? (
        <section className="connection-entry" aria-label="选择连接方式">
          <button
            type="button"
            className="connection-entry-card connection-entry-card-primary"
            disabled={loading}
            onClick={() => void onLanConnect()}
          >
            <span className="connection-entry-icon"><ScanLineIcon /></span>
            <span className="connection-entry-copy">
              <strong>{lanStatus || '局域网连接'}</strong>
              <small>{lanStatus ? '请保持 App 在前台' : '扫描 Mac 上的二维码，无需服务器地址或密码'}</small>
            </span>
            <span className="connection-entry-arrow" aria-hidden>›</span>
          </button>
          <button
            type="button"
            className="connection-entry-card"
            disabled={loading}
            onClick={() => { setError(null); setLanStatus(null); setConnectionMode('remote') }}
          >
            <span className="connection-entry-icon"><GlobeIcon /></span>
            <span className="connection-entry-copy">
              <strong>远程连接</strong>
              <small>通过中继服务器，从任意网络访问</small>
            </span>
            <span className="connection-entry-arrow" aria-hidden>›</span>
          </button>
          {error ? <p className="error login-connection-error" role="alert">{error}</p> : null}
        </section>
      ) : (
      <form className="login-form login-form-enter" onSubmit={onSubmit}>
        <button type="button" className="login-back" onClick={() => { setError(null); setConnectionMode('choose') }}>‹ 选择连接方式</button>
        <p className="login-form-title">远程连接</p>
        {
          <label className="field">
            <span>Relay API</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://relay.example.com"
              value={apiBaseDraft}
              onChange={(e) => setApiBaseDraft(e.target.value)}
            />
          </label>
        }
        <label className="field">
          <span>Site password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button
          type="submit"
          className="btn primary login-submit"
          disabled={loading || !password.trim()}
          aria-busy={loading}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      )}
    </div>
  )
}
