import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  clearToken,
  fetchInstances,
  fetchNotifyPrefs,
  fetchVersion,
  hasUnlockToken,
  updateNotifyPrefs,
  type NotifyPrefs,
  type PublicInstance,
} from '../api'
import { PageShell } from '../components/PageShell'
import { getApiBase, setApiBase } from '../utils/apiBase'

/** 一台已解锁电脑上的两条 Bark 开关 */
function NotifyInstanceCard({ inst }: { inst: PublicInstance }) {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchNotifyPrefs(inst.instance_id)
        if (!cancelled) setPrefs(next)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载通知设置失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [inst.instance_id])

  /** 改一条开关并立刻写回这台电脑 */
  async function toggle(key: keyof NotifyPrefs, next: boolean) {
    if (!prefs || busy) return
    const prev = prefs
    const body = { ...prefs, [key]: next }
    setPrefs(body)
    setBusy(true)
    setErr(null)
    try {
      setPrefs(await updateNotifyPrefs(inst.instance_id, body))
    } catch (e) {
      setPrefs(prev)
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-block">
      <div className="settings-block-title">{inst.display_name || inst.instance_id}</div>
      {err ? <p className="error-banner">{err}</p> : null}
      <label className="settings-row settings-toggle-row">
        <span>
          <span className="settings-label">完成通知</span>
          <span className="settings-hint">任务结束且两端都没看对话时推送</span>
        </span>
        <span className={`settings-switch${busy ? ' busy' : ''}`}>
          <input
            type="checkbox"
            checked={!!prefs?.task_done}
            disabled={busy || !prefs}
            onChange={(e) => void toggle('task_done', e.target.checked)}
          />
          <span />
        </span>
      </label>
      <label className="settings-row settings-toggle-row">
        <span>
          <span className="settings-label">命令审批通知</span>
          <span className="settings-hint">有命令待审批且两端都没看对话时推送</span>
        </span>
        <span className={`settings-switch${busy ? ' busy' : ''}`}>
          <input
            type="checkbox"
            checked={!!prefs?.permission}
            disabled={busy || !prefs}
            onChange={(e) => void toggle('permission', e.target.checked)}
          />
          <span />
        </span>
      </label>
    </div>
  )
}

/** Site settings: version + API 基址(App) + Bark 通知开关 + changelog entry */
export function SettingsPage() {
  const navigate = useNavigate()
  const [version, setVersion] = useState<string>('…')
  const [error, setError] = useState<string | null>(null)
  const [instances, setInstances] = useState<PublicInstance[]>([])
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

  useEffect(() => {
    void (async () => {
      try {
        setInstances(await fetchInstances())
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          navigate('/login', { replace: true })
        }
      }
    })()
  }, [navigate])

  /** 保存中继地址并刷新版本探测 */
  function saveApiBase() {
    setApiBase(apiBaseDraft)
    setApiSaved(true)
    window.setTimeout(() => setApiSaved(false), 1600)
  }

  const unlocked = instances.filter((inst) => hasUnlockToken(inst.instance_id))

  return (
    <PageShell title="设置" backTo="/instances">
      {error ? <p className="error-banner">{error}</p> : null}
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
      <h2 className="settings-section-title">通知</h2>
      <p className="settings-section-hint">与电脑端「设置 · 通知」同一开关。离开对话后是否推送到手机。</p>
      {unlocked.length === 0 ? (
        <div className="settings-block">
          <p className="settings-hint">请先进入一台电脑，再回来开关通知。</p>
        </div>
      ) : (
        unlocked.map((inst) => <NotifyInstanceCard key={inst.instance_id} inst={inst} />)
      )}
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
