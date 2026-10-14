import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clearToken, fetchTasks, type PublicMirrorTask } from '../api'
import { PageShell } from '../components/PageShell'

/** Tasks mirror for one agent */
export function AgentDetailPage() {
  const { instanceId = '', agentId = '' } = useParams()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<PublicMirrorTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  /** Fetch tasks for agent */
  const load = useCallback(async () => {
    if (!instanceId || !agentId) return
    setError(null)
    try {
      setTasks(await fetchTasks(instanceId, agentId))
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
  }, [instanceId, agentId, navigate])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(id)
  }, [load])

  const agentsPath = `/instances/${encodeURIComponent(instanceId)}/agents`
  const chatPath = `${agentsPath}/${encodeURIComponent(agentId)}/chat`

  return (
    <PageShell
      title="任务"
      backTo={agentsPath}
      right={
        <Link to={chatPath} className="btn primary small">
          聊天
        </Link>
      }
    >
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && tasks.length === 0 ? <p className="muted">暂无任务</p> : null}
      <ul className="list">
        {tasks.map((t) => (
          <li key={t.task_id} className="list-item static">
            <div>
              <div className="list-title">{t.task_id}</div>
              <div className="list-sub">{t.status ?? '—'}</div>
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  )
}
