import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { clearToken, getToken, login } from '../api'

/** Site gate — branded home / sign-in */
export function LoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (getToken()) {
    return <Navigate to="/instances" replace />
  }

  /** Submit site password */
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(password.trim())
      navigate('/instances', { replace: true })
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

  return (
    <div className="page page-center login-home">
      <div className="login-brand">
        <div className="login-logo-wrap" aria-hidden>
          <img
            className="login-logo"
            src="/brand-jellyfish-white.png"
            alt=""
            width={88}
            height={88}
          />
        </div>
        <h1 className="login-product">Atolla</h1>
        <p className="login-tagline">Remote Relay</p>
        <p className="login-desc">Sign in with your site password to access Mac instances.</p>
      </div>

      <form className="login-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Site password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
          />
        </label>
        {error ? <p className="error-banner">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={loading || !password.trim()}>
          {loading ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
