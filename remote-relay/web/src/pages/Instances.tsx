import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  clearToken,
  fetchInstances,
  revokeInstancePassword,
  type PublicInstance,
} from '../api'
import { PageShell } from '../components/PageShell'
import { instanceSubtitle, isInstanceOnline } from '../utils/instance'

/** List Mac instances with online state and revoke */
export function InstancesPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<PublicInstance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  /** Load instance list from API */
  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await fetchInstances())
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
      if (msg.includes('Unauthorized') || msg.includes('401')) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    void load()
    const tick = window.setInterval(() => setNow(Date.now()), 10_000)
    const refresh = window.setInterval(() => void load(), 15_000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(refresh)
    }
  }, [load])

  /** Revoke instance password after confirm */
  async function onRevoke(instanceId: string, name: string) {
    if (!window.confirm(`确定吊销「${name}」的实例密码？`)) return
    setRevokingId(instanceId)
    setError(null)
    try {
      await revokeInstancePassword(instanceId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '吊销失败')
    } finally {
      setRevokingId(null)
    }
  }

  function logout() {
    clearToken()
    navigate('/login', { replace: true })
  }

  return (
    <PageShell
      title="实例"
      right={
        <button type="button" className="btn text" onClick={logout}>
          退出
        </button>
      }
    >
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && items.length === 0 ? <p className="muted">暂无实例</p> : null}
      <ul className="list">
        {items.map((inst) => {
          const online = isInstanceOnline(inst.last_heartbeat_at, now)
          return (
            <li key={inst.instance_id} className="list-item">
              <Link
                to={`/instances/${encodeURIComponent(inst.instance_id)}/agents`}
                className="list-link"
              >
                <span className={`dot ${online ? 'online' : 'offline'}`} />
                <div>
                  <div className="list-title">{inst.display_name}</div>
                  <div className="list-sub">{instanceSubtitle(inst, now)}</div>
                </div>
              </Link>
              <button
                type="button"
                className="btn danger outline small"
                disabled={revokingId === inst.instance_id}
                onClick={() => void onRevoke(inst.instance_id, inst.display_name)}
              >
                吊销
              </button>
            </li>
          )
        })}
      </ul>
    </PageShell>
  )
}
