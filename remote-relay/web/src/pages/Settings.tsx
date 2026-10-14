import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearToken, fetchVersion } from '../api'
import { PageShell } from '../components/PageShell'

/** Site settings: version + changelog entry */
export function SettingsPage() {
  const navigate = useNavigate()
  const [version, setVersion] = useState<string>('…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const v = await fetchVersion()
        setVersion(v.startsWith('v') ? v : `v${v}`)
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          navigate('/login', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : '加载失败')
        setVersion('—')
      }
    })()
  }, [navigate])

  return (
    <PageShell title="设置" backTo="/instances">
      {error ? <p className="error-banner">{error}</p> : null}
      <div className="settings-block">
        <div className="settings-row">
          <span className="settings-label">当前版本</span>
          <span className="settings-value">{version}</span>
        </div>
      </div>
      <ul className="list settings-menu">
        <li className="list-item">
          <Link to="/settings/changelog" className="list-link">
            <div className="list-title">更新记录</div>
            <div className="list-sub">查看各版本变更</div>
          </Link>
        </li>
      </ul>
    </PageShell>
  )
}
