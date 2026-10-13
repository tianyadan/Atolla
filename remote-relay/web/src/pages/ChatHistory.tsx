import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  clearToken,
  fetchMessages,
  syncMessages,
  type PublicMirrorMessage,
} from '../api'
import { PageShell } from '../components/PageShell'

const POLL_MS = 4_000
const MESSAGE_LIMIT = 50

/** Read-only chat mirror; sync on open then poll */
export function ChatHistoryPage() {
  const { instanceId = '', agentId = '' } = useParams()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<PublicMirrorMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  /** Pull messages from relay mirror */
  const loadMessages = useCallback(async () => {
    if (!instanceId || !agentId) return
    try {
      const page = await fetchMessages(instanceId, agentId, { limit: MESSAGE_LIMIT })
      setMessages(page.messages)
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
  }, [instanceId, agentId, navigate])

  /** Initial sync command then start polling; re-run when route params change */
  useEffect(() => {
    if (!instanceId || !agentId) return
    let cancelled = false

    setLoading(true)
    setMessages([])
    setError(null)

    async function start() {
      setSyncing(true)
      try {
        await syncMessages(instanceId, agentId, { limit: MESSAGE_LIMIT })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '同步失败')
        }
      } finally {
        if (!cancelled) setSyncing(false)
      }
      if (!cancelled) await loadMessages()
    }

    void start()
    const poll = window.setInterval(() => void loadMessages(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [instanceId, agentId, loadMessages])

  const detailPath = `/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}`

  return (
    <PageShell title="聊天记录" backTo={detailPath}>
      {syncing ? <p className="muted">正在向 Mac 请求同步…</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && messages.length === 0 ? <p className="muted">暂无消息</p> : null}
      <div className="chat-thread">
        {[...messages].reverse().map((m) => (
          <article key={m.message_id} className={`chat-bubble role-${m.role ?? 'unknown'}`}>
            <header>{m.role ?? 'message'}</header>
            <p>{m.content ?? '（无内容）'}</p>
          </article>
        ))}
      </div>
    </PageShell>
  )
}
