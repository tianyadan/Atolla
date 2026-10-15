import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clearToken, fetchAgents, logoutUnlockSession } from '../api'
import { AgentsHubIcon, GroupChatHubIcon } from '../components/HubIcons'
import { PageShell } from '../components/PageShell'
import { useUnlockHeartbeat } from '../hooks/useUnlockHeartbeat'
import { countBusyAgents } from '../utils/agentStatus'

/** 4-grid feature menu after instance unlock */
export function InstanceHubPage() {
  const { instanceId = '' } = useParams()
  const navigate = useNavigate()
  const [toast, setToast] = useState<string | null>(null)
  const [busyCount, setBusyCount] = useState(0)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const base = `/instances/${encodeURIComponent(instanceId)}`

  useUnlockHeartbeat(instanceId || undefined)

  /** Refresh busy badge count */
  const loadBusy = useCallback(async () => {
    if (!instanceId) return
    try {
      const agents = await fetchAgents(instanceId)
      setBusyCount(countBusyAgents(agents))
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      const status = (err as { status?: number })?.status
      if (msg.includes('Unauthorized') || status === 401) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      if (status === 403 || msg.includes('实例密码')) {
        navigate('/instances', { replace: true })
      }
    }
  }, [instanceId, navigate])

  useEffect(() => {
    void loadBusy()
    const id = window.setInterval(() => void loadBusy(), 15_000)
    return () => window.clearInterval(id)
  }, [loadBusy])

  /** Show under-development notice */
  function onGroupChat() {
    setToast('群聊功能正在开发')
    window.setTimeout(() => setToast(null), 2200)
  }

  /** Revoke this phone unlock on server (site gate stays) */
  async function onLogoutDevice() {
    if (!instanceId || logoutBusy) return
    setLogoutBusy(true)
    try {
      await logoutUnlockSession(instanceId)
      navigate('/instances', { replace: true })
    } catch {
      setToast('注销失败，请稍后重试')
      window.setTimeout(() => setToast(null), 2200)
    } finally {
      setLogoutBusy(false)
    }
  }

  return (
    <PageShell title="功能" backTo="/instances">
      {toast ? <p className="toast-banner">{toast}</p> : null}
      <div className="hub-grid">
        <button
          type="button"
          className="hub-cell"
          onClick={() => navigate(`${base}/agents`)}
        >
          <span className="hub-icon">
            <AgentsHubIcon />
            {busyCount > 0 ? (
              <span className="busy-count-badge hub-busy-badge" title={`忙碌中 ${busyCount}`}>
                {busyCount}
              </span>
            ) : null}
          </span>
          <span className="hub-label">数字员工</span>
        </button>
        <button type="button" className="hub-cell" onClick={onGroupChat}>
          <span className="hub-icon">
            <GroupChatHubIcon />
          </span>
          <span className="hub-label">群聊</span>
        </button>
        <div className="hub-cell hub-cell-empty" aria-hidden>
          <span className="hub-icon muted">+</span>
          <span className="hub-label muted">敬请期待</span>
        </div>
        <div className="hub-cell hub-cell-empty" aria-hidden>
          <span className="hub-icon muted">+</span>
          <span className="hub-label muted">敬请期待</span>
        </div>
      </div>
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button
          type="button"
          className="ghost"
          disabled={logoutBusy}
          onClick={() => void onLogoutDevice()}
        >
          {logoutBusy ? '注销中…' : '注销本机解锁'}
        </button>
        <p className="empty-hint" style={{ marginTop: 8 }}>
          清除本机对该实例的 7 天解锁；站点大门登录不受影响
        </p>
      </div>
    </PageShell>
  )
}
