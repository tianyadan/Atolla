import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearToken, fetchVersion } from '../api'
import { PageShell } from '../components/PageShell'
import { getApiBase, setApiBase } from '../utils/apiBase'

/**
 * 全局 / 实例大门设置：版本、中继地址、更新记录。
 * 通知与 JEV 已迁到「进入实例 → 功能 → 设置」。
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const [version, setVersion] = useState<string>('…')
  const [error, setError] = useState<string | null>(null)
  const [apiBaseDraft, setApiBaseDraft] = useState(() => getApiBase())
  const [apiSaved, setApiSaved] = useState(false)
  const showApiBase = Capacitor.isNativePlatform() || !!getApiBase() || !!import.meta.env.VITE_API_BASE

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

  /** 保存中继地址 */
  function saveApiBase() {
    setApiBase(apiBaseDraft)
    setApiSaved(true)
    window.setTimeout(() => setApiSaved(false), 1600)
  }

  return (
    <PageShell title="设置" backTo="/instances">
      {error ? <p className="error-banner">{error}</p> : null}

      <h2 className="settings-section-title">应用</h2>
      <div className="settings-block">
        <div className="settings-row">
          <span className="settings-label">当前版本</span>
          <span className="settings-value">{version}</span>
        </div>
      </div>

      {showApiBase ? (
        <>
          <h2 className="settings-section-title">中继服务</h2>
          <p className="settings-section-hint">
            App 壳内无浏览器同源代理，请填写可访问的中继根地址（含 https://，不要末尾斜杠）。
          </p>
          <div className="settings-block">
            <label className="field" style={{ display: 'block', padding: '0.75rem 0' }}>
              <span className="settings-label">API 地址</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="https://your-relay.example.com"
                value={apiBaseDraft}
                onChange={(e) => setApiBaseDraft(e.target.value)}
              />
            </label>
            <button type="button" className="btn primary" onClick={saveApiBase}>
              {apiSaved ? '已保存' : '保存'}
            </button>
          </div>
        </>
      ) : null}

      <h2 className="settings-section-title">其它</h2>
      <p className="settings-section-hint">
        通知、JEV 等与电脑数字人相关的选项，请进入某台电脑后，在「功能 → 设置」中配置。
      </p>
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
