import { useEffect, useRef, useState } from 'react'
import AgentMarkdown from '../agentMarkdown.jsx'
import { getAgentSession, patchAgentSession, setAgentChatLog, subscribeAgentSessions } from '../managedAgentSessions.js'

const API = '/api'
const PAGE_SIZE = 40

/**
 * 右侧 ~480px 对话抽屉：复用会话 messages / 授权，可展开到完整对话页。
 */
export default function JellyDrawer({
  open,
  agent,
  approvals = [],
  authHeaders,
  onUnauthorized,
  onClose,
  onExpand,
  onApprovalAction,
  /** 演示/离线时的种子消息 */
  seedMessages = null,
}) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setVer] = useState(0)
  const boxRef = useRef(null)
  const agentId = agent?.agentId || (Number(agent?.id) || agent?.id) || 0
  const numericId = Number(agentId) || 0

  useEffect(() => subscribeAgentSessions(() => setVer((v) => v + 1)), [])

  useEffect(() => {
    if (!open || !agentId) {
      setMsgs([])
      return undefined
    }
    if (seedMessages) {
      setMsgs(seedMessages)
      return undefined
    }
    if (!numericId) return undefined
    let cancelled = false
    async function load() {
      const res = await fetch(`${API}/admin/agents/${numericId}/messages?limit=${PAGE_SIZE}`, {
        headers: authHeaders(),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) return
      const d = await res.json()
      if (cancelled) return
      const items = (d.items || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        time: m.created_at ? new Date(m.created_at).getTime() : 0,
      }))
      setMsgs(items)
      // 同步进 session，便于授权 overlay / 展开后经典页复用
      if (!getAgentSession(numericId).loading) {
        setAgentChatLog(numericId, items)
        patchAgentSession(numericId, {
          convId: d.conversation_id || 0,
          totalMessages: d.total || 0,
          hasMore: !!d.has_more,
        })
      }
      const conv = d.conversation_id || getAgentSession(numericId).convId
      if (conv) {
        fetch(`${API}/permissions/pending?conversation_id=${conv}`)
          .then((r) => r.json())
          .then((pd) => {
            const pending = pd.items || []
            if (pending.length) {
              patchAgentSession(numericId, {
                permQueue: pending,
              })
            }
          })
          .catch(() => {})
      }
    }
    load()
    const t = setInterval(load, 4000)
    return () => { cancelled = true; clearInterval(t) }
  }, [open, agentId, numericId, authHeaders, onUnauthorized, seedMessages])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [msgs, open, approvals])

  const sess = numericId ? getAgentSession(numericId) : { chatLog: [] }
  const live = (sess.chatLog?.length ? sess.chatLog : msgs)
  const mineApprovals = (approvals || []).filter((ap) => String(ap.agentId) === String(agentId) || String(ap.agentId) === String(agent?.id))

  async function send() {
    const q = text.trim()
    if (!q || !numericId || busy) return
    setText('')
    setBusy(true)
    setMsgs((prev) => [...prev, { role: 'user', content: q, time: Date.now() }])
    setAgentChatLog(numericId, (prev) => [...(prev || []), { role: 'user', content: q, time: Date.now() }])
    try {
      const res = await fetch(`${API}/admin/agents/${numericId}/ask`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question: q }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      // 流式：追加 assistant
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let assistant = ''
      setMsgs((prev) => [...prev, { role: 'assistant', content: '', time: Date.now(), live: true }])
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''
        for (const block of parts) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue
            try {
              const ev = JSON.parse(line.slice(5).trim())
              if (ev.type === 'chunk' && ev.text) {
                assistant += ev.text
                setMsgs((prev) => {
                  const n = [...prev]
                  const last = n[n.length - 1]
                  if (last?.role === 'assistant') n[n.length - 1] = { ...last, content: assistant }
                  return n
                })
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      setMsgs((prev) => [...prev, { role: 'assistant', content: String(err.message || err), error: true, time: Date.now() }])
    } finally {
      setBusy(false)
    }
  }

  const stateClass = agent?.s === 'wait' ? 'wait' : agent?.s === 'idle' ? 'idle' : ''

  return (
    <aside className={`jelly-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="jelly-dh">
        <span className={`jelly-dot ${stateClass}`} />
        <b>{agent?.n || '员工'}</b>
        <small>{agent?.t || ''}</small>
        <button type="button" className="jelly-btn ghost" title="展开成完整对话页" onClick={() => onExpand?.(numericId || agentId)}>⤢</button>
        <button type="button" className="jelly-btn ghost" onClick={onClose} aria-label="关闭">✕</button>
      </div>
      <div className="jelly-msgs" ref={boxRef}>
        {live.length === 0 && (
          <div className="m ag muted">
            {agent?.s === 'idle' ? '我现在空着，有活随时叫我。' : `正在做：${agent?.t || '…'}`}
          </div>
        )}
        {live.map((m, i) => {
          if (m.role === 'user') {
            return <div key={m.id || `u${i}`} className="m me">{m.content}</div>
          }
          if (m.role === 'assistant' || m.role === 'status') {
            return (
              <div key={m.id || `a${i}`} className={`m ag ${m.error ? 'err' : ''}`}>
                <AgentMarkdown content={m.content || ''} agentId={numericId || agentId} authHeaders={authHeaders} />
              </div>
            )
          }
          if (m.role === 'command') {
            return (
              <div key={m.id || `c${i}`} className="m ag">
                <code>{m.content}</code>
              </div>
            )
          }
          return null
        })}
        {mineApprovals.map((ap) => (
          <div key={ap.id} className="m ag jelly-appr-in">
            <div className="w">等你拍板</div>
            <div>{ap.title}</div>
            <div className="row">
              {(ap.actions || []).slice(0, 2).map((x) => (
                <button
                  key={x.k}
                  type="button"
                  className={`jelly-btn ${x.pri ? 'pri' : ''}`}
                  onClick={() => onApprovalAction?.(ap, x.k)}
                >
                  {x.l}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="jelly-din">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder="和 TA 说点什么…"
          disabled={!open}
        />
        <button type="button" className="jelly-btn" onClick={send} disabled={busy || !text.trim()}>发送</button>
      </div>
    </aside>
  )
}
