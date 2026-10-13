import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clearToken, fetchAgents, type PublicMirrorAgent } from '../api'
import { PageShell } from '../components/PageShell'

/** Agents mirror for one instance */
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
      if (msg.includes('Unauthorized')) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [instanceId, navigate])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(id)
  }, [load])

  const base = `/instances/${encodeURIComponent(instanceId)}`

  return (
    <PageShell title="数字人" backTo="/instances">
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && agents.length === 0 ? <p className="muted">暂无数字人数据</p> : null}
      <ul className="list">
        {agents.map((a) => (
          <li key={a.agent_id} className="list-item">
            <Link to={`${base}/agents/${encodeURIComponent(a.agent_id)}`} className="list-link">
              <div>
                <div className="list-title">{a.display_name || a.agent_id}</div>
                <div className="list-sub">
                  {[a.status, a.engine].filter(Boolean).join(' · ') || a.agent_id}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  )
}
