import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { clearToken, getToken, login } from '../api'

/** Site gate password login */
export function LoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (getToken()) {
    return <Navigate to="/instances" replace />
  }

  /** Submit gate password */
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(password.trim())
      navigate('/instances', { replace: true })
    } catch (err) {
      clearToken()
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page page-center">
      <div className="card login-card">
        <h1>Remote Relay</h1>
        <p className="muted">输入站点密码以只读访问实例</p>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="站点密码"
              required
            />
          </label>
          {error ? <p className="error-banner">{error}</p> : null}
          <button type="submit" className="btn primary" disabled={loading || !password.trim()}>
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
