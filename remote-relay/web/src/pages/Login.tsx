import { Capacitor } from '@capacitor/core'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, getToken, hasUnlockToken, login } from '../api'
import { getApiBase, setApiBase } from '../utils/apiBase'
import {
  loadPendingDeepLink,
  navigateToDeepLinkChat,
} from '../utils/deepLink'

/** 已登录时的落地：有待处理深链则进对话（带列表返回栈），否则进实例列表 */
function resumeAfterAuth(navigate: ReturnType<typeof useNavigate>): void {
  const target = loadPendingDeepLink()
  if (!target) {
    navigate('/instances', { replace: true })
    return
  }
  if (!hasUnlockToken(target.instanceId)) {
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
  const native = Capacitor.isNativePlatform()
  const [apiBaseDraft, setApiBaseDraft] = useState(() => getApiBase())
  const showApiField = native || !!getApiBase() || !!import.meta.env.VITE_API_BASE
  const authed = !!getToken()

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
        <p className="login-desc">Sign in with your site password to access Mac instances.</p>
      </div>

      <form className="card login-card" onSubmit={onSubmit}>
        {showApiField ? (
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
        ) : null}
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
        <button type="submit" className="primary-btn" disabled={loading || !password.trim()}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
