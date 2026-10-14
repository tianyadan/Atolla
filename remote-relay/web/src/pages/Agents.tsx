import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clearToken, fetchAgents, type PublicMirrorAgent } from '../api'
import { PageShell } from '../components/PageShell'
import {
  agentAvatarUrl,
  agentStatusLabel,
  groupAgentsByFolder,
} from '../utils/agentStatus'

/** Agents mirror grouped by work folder */
export function AgentsPage() {
  const { instanceId = '' } = useParams()
  const navigate = useNavigate()
  const [agents, setAgents] = useState<PublicMirrorAgent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  /** Fetch agents list */
  const load = useCallback(async () => {
    if (!instanceId) return
    setError(null)
    try {
      setAgents(await fetchAgents(instanceId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      const status = (err as { status?: number })?.status
      if (msg.includes('Unauthorized') || status === 401) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      if (status === 403 || msg.includes('实例密码')) {
        navigate('/instances', { replace: true })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [instanceId, navigate])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const groups = useMemo(() => groupAgentsByFolder(agents), [agents])
  const hub = `/instances/${encodeURIComponent(instanceId)}`
  const chatBase = `${hub}/agents`

  return (
    <PageShell title="数字员工" backTo={hub}>
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && agents.length === 0 ? <p className="muted">暂无数字人数据</p> : null}
      {groups.map((g) => (
        <section key={g.key} className="agent-folder">
          <h2 className="agent-folder-title">{g.title}</h2>
          <ul className="list">
            {g.agents.map((a) => (
              <li key={a.agent_id} className="list-item agent-card">
                <button
                  type="button"
                  className="agent-card-btn"
                  onClick={() =>
                    navigate(`${chatBase}/${encodeURIComponent(a.agent_id)}/chat`)
                  }
                >
                  <img
                    className="agent-avatar"
                    src={agentAvatarUrl(a.payload)}
                    alt=""
                  />
                  <div className="agent-card-meta">
                    <div className="list-title">{a.display_name || a.agent_id}</div>
                    <div className="list-sub">
                      <span
                        className={`status-pill ${
                          agentStatusLabel(a.status) === '忙碌中' ? 'busy' : 'idle'
                        }`}
                      >
                        {agentStatusLabel(a.status)}
                      </span>
                      {a.engine ? <span className="muted"> · {a.engine}</span> : null}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageShell>
  )
}
