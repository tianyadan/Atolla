import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JellyAvatar from './JellyAvatar.jsx'
import { resolveJellyColor } from './jellyColor.js'
import AgentMarkdown from './agentMarkdown.jsx'

const API = '/api'

/** 解析 SSE data: 行 */
function parseSSE(buf) {
  const events = []
  let rest = buf
  let idx
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const raw = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    const line = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    const json = line.slice(5).trim()
    try {
      const ev = JSON.parse(json)
      if (typeof ev.content === 'string') {
        ev.content = ev.content.replace(/\\n/g, '\n')
      }
      events.push(ev)
    } catch { /* ignore */ }
  }
  return { events, rest }
}

function parseSpeakerMeta(metaJson) {
  if (!metaJson || typeof metaJson !== 'string') return null
  try {
    const m = JSON.parse(metaJson)
    if (!m || typeof m !== 'object') return null
    return {
      agentId: Number(m.speaker_agent_id) || 0,
      name: String(m.speaker_name || '').trim(),
    }
  } catch {
    return null
  }
}

function msgFromServer(m) {
  const speaker = parseSpeakerMeta(m.meta_json)
  return {
    key: `m-${m.id}`,
    id: m.id,
    role: m.role,
    content: m.content || '',
    speakerAgentId: speaker?.agentId || 0,
    speakerName: speaker?.name || '',
    streaming: false,
  }
}

/**
 * PC 群聊：列表/时间线/开会 SSE/续聊 @ / 标签 / 转让群主。
 */
export default function GroupChats({
  authHeaders,
  onUnauthorized,
  active = true,
  focusGroupId = 0,
  onFocusConsumed,
  autoStartMeeting = true,
}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [selectedId, setSelectedId] = useState(0)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [timeline, setTimeline] = useState([])
  const [busy, setBusy] = useState(false)
  const [liveSpeakerId, setLiveSpeakerId] = useState(0)
  const [draft, setDraft] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [memberMenu, setMemberMenu] = useState(null) // member object
  const [tagDraft, setTagDraft] = useState('')
  const [memberBusy, setMemberBusy] = useState(false)
  const abortRef = useRef(null)
  const pendingAutostartRef = useRef(0)
  const boxRef = useRef(null)
  const composerRef = useRef(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/group-chats`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '加载群聊失败')
      setItems(d.items || [])
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onUnauthorized])

  const applyDetail = useCallback((d) => {
    setDetail(d)
    setTimeline((d.messages?.items || []).map(msgFromServer))
  }, [])

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null)
      setTimeline([])
      return
    }
    setDetailLoading(true)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/group-chats/${id}?limit=80`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '加载群详情失败')
      applyDetail(d)
    } catch (e) {
      setErr(String(e.message || e))
      setDetail(null)
      setTimeline([])
    } finally {
      setDetailLoading(false)
    }
  }, [authHeaders, onUnauthorized, applyDetail])

  useEffect(() => {
    if (active) loadList()
  }, [active, loadList])

  useEffect(() => {
    if (!active || !focusGroupId) return
    setSelectedId(focusGroupId)
    if (autoStartMeeting) pendingAutostartRef.current = focusGroupId
    loadDetail(focusGroupId)
    loadList()
    onFocusConsumed?.()
  }, [active, focusGroupId, autoStartMeeting, loadDetail, loadList, onFocusConsumed])

  useEffect(() => {
    if (!active || !selectedId) return
    if (pendingAutostartRef.current === selectedId) return
    loadDetail(selectedId)
  }, [active, selectedId, loadDetail])

  const memberById = useMemo(() => {
    const map = new Map()
    for (const m of detail?.members || []) map.set(Number(m.agent_id), m)
    return map
  }, [detail])

  const members = detail?.members || []

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [timeline, liveSpeakerId])

  const applyStreamEvents = useCallback((events) => {
    for (const ev of events) {
      const typ = ev.type
      if (typ === 'user_message') {
        setTimeline((prev) => [
          ...prev,
          {
            key: `u-${Date.now()}-${prev.length}`,
            id: 0,
            role: 'user',
            content: String(ev.content || ''),
            speakerAgentId: 0,
            speakerName: '',
            streaming: false,
          },
        ])
      } else if (typ === 'speaker') {
        const sid = Number(ev.speaker_agent_id) || 0
        const sname = String(ev.speaker_name || '')
        setLiveSpeakerId(sid)
        setTimeline((prev) => [
          ...prev,
          {
            key: `live-${sid}-${Date.now()}-${prev.length}`,
            id: 0,
            role: 'assistant',
            content: '',
            speakerAgentId: sid,
            speakerName: sname,
            streaming: true,
          },
        ])
      } else if (typ === 'chunk') {
        const chunk = String(ev.content || '')
        const sid = Number(ev.speaker_agent_id) || 0
        setTimeline((prev) => {
          const n = [...prev]
          for (let i = n.length - 1; i >= 0; i--) {
            if (n[i].streaming && (!sid || n[i].speakerAgentId === sid)) {
              n[i] = { ...n[i], content: (n[i].content || '') + chunk }
              return n
            }
          }
          return n
        })
      } else if (typ === 'done' && (ev.speaker_agent_id || ev.message_id)) {
        const sid = Number(ev.speaker_agent_id) || 0
        const mid = Number(ev.message_id) || 0
        setTimeline((prev) => {
          const n = [...prev]
          for (let i = n.length - 1; i >= 0; i--) {
            if (n[i].streaming && (!sid || n[i].speakerAgentId === sid)) {
              n[i] = { ...n[i], streaming: false, id: mid || n[i].id }
              break
            }
          }
          return n
        })
        setLiveSpeakerId(0)
      } else if (typ === 'error') {
        setErr(String(ev.message || ev.error || '出错了'))
      }
    }
  }, [])

  const runSSE = useCallback(async (url, body) => {
    if (busy) return
    setBusy(true)
    setErr('')
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parsed = parseSSE(buf)
        buf = parsed.rest
        applyStreamEvents(parsed.events)
      }
      if (selectedId) {
        await loadDetail(selectedId)
        loadList()
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setErr(String(e.message || e))
    } finally {
      setBusy(false)
      setLiveSpeakerId(0)
      abortRef.current = null
    }
  }, [busy, authHeaders, onUnauthorized, applyStreamEvents, selectedId, loadDetail, loadList])

  const startMeeting = useCallback((groupId) => {
    if (!groupId) return
    runSSE(`${API}/admin/group-chats/${groupId}/start-meeting`)
  }, [runSSE])

  useEffect(() => {
    if (!active || !selectedId || !detail) return
    if (pendingAutostartRef.current !== selectedId) return
    pendingAutostartRef.current = 0
    startMeeting(selectedId)
  }, [active, selectedId, detail, startMeeting])

  function selectGroup(id) {
    abortRef.current?.abort()
    pendingAutostartRef.current = 0
    setMemberMenu(null)
    setDraft('')
    setSelectedId(id)
  }

  function stopBusy() {
    abortRef.current?.abort()
  }

  function onDraftChange(e) {
    const v = e.target.value
    setDraft(v)
    const caret = e.target.selectionStart || v.length
    const before = v.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at >= 0 && !/\s/.test(before.slice(at + 1)) && !before.slice(at).includes('](')) {
      setMentionOpen(true)
      setMentionIdx(0)
    } else {
      setMentionOpen(false)
    }
  }

  function insertMention(m) {
    const el = composerRef.current
    const v = draft
    const caret = el?.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const after = v.slice(caret)
    const at = before.lastIndexOf('@')
    const name = m.name || `#${m.agent_id}`
    const token = `@[${name}](#agent:${m.agent_id}) `
    const next = (at >= 0 ? before.slice(0, at) : before) + token + after
    setDraft(next)
    setMentionOpen(false)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = (at >= 0 ? at : caret) + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function sendAsk() {
    const q = draft.trim()
    if (!q || !selectedId || busy) return
    setDraft('')
    setMentionOpen(false)
    await runSSE(`${API}/admin/group-chats/${selectedId}/ask`, { question: q })
  }

  function onComposerKey(e) {
    if (mentionOpen && members.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % members.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + members.length) % members.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(members[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        setMentionOpen(false)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      sendAsk()
    }
  }

  function openMemberMenu(m) {
    setMemberMenu(m)
    setTagDraft(m.group_tag || '')
  }

  async function saveTag() {
    if (!memberMenu || !selectedId) return
    setMemberBusy(true)
    try {
      const res = await fetch(
        `${API}/admin/group-chats/${selectedId}/members/${memberMenu.agent_id}`,
        {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ group_tag: tagDraft }),
        },
      )
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '保存标签失败')
      await loadDetail(selectedId)
      setMemberMenu(null)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setMemberBusy(false)
    }
  }

  async function transferOwner() {
    if (!memberMenu || !selectedId) return
    if (memberMenu.role === 'owner') return
    if (!window.confirm(`将群主转让给「${memberMenu.name || memberMenu.agent_id}」？`)) return
    setMemberBusy(true)
    try {
      const res = await fetch(`${API}/admin/group-chats/${selectedId}/transfer-owner`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ new_owner_agent_id: memberMenu.agent_id }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '转让失败')
      await loadDetail(selectedId)
      loadList()
      setMemberMenu(null)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setMemberBusy(false)
    }
  }

  return (
    <section className="gc-layout">
      <aside className="gc-list-pane">
        <div className="gc-list-head">
          <h2 className="gc-title">群聊</h2>
          <button type="button" className="gc-refresh" onClick={loadList} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
        {err && <p className="error gc-err">{err}</p>}
        {!loading && items.length === 0 && (
          <div className="gc-empty">
            <p>还没有群聊</p>
            <p className="muted">在对话里 @ 3～5 位同事并点「生成群聊」即可开会</p>
          </div>
        )}
        <ul className="gc-list">
          {items.map((g) => {
            const ms = g.members || []
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className={`gc-item${selectedId === g.id ? ' active' : ''}`}
                  onClick={() => selectGroup(g.id)}
                >
                  <div className="gc-item-avatars" aria-hidden="true">
                    {ms.slice(0, 5).map((m, i) => (
                      <span key={m.agent_id} className="gc-stack-jelly" style={{ zIndex: 5 - i, marginLeft: i ? -10 : 0 }}>
                        <JellyAvatar
                          color={resolveJellyColor({ jelly_color: m.jelly_color })}
                          size={28}
                          state="idle"
                          title={m.name || `#${m.agent_id}`}
                        />
                      </span>
                    ))}
                  </div>
                  <div className="gc-item-meta">
                    <span className="gc-item-name">{g.name}</span>
                    <span className="gc-item-sub">
                      {g.member_count || ms.length} 人
                      {g.seed_question ? ` · ${String(g.seed_question).slice(0, 24)}` : ''}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <div className="gc-detail-pane">
        {!selectedId && (
          <div className="gc-empty gc-detail-empty">
            <p>选择左侧群聊查看时间线</p>
          </div>
        )}
        {selectedId > 0 && detailLoading && !detail && (
          <p className="muted gc-detail-loading">加载中…</p>
        )}
        {detail && (
          <>
            <header className="gc-detail-head">
              <div className="gc-detail-head-row">
                <div>
                  <h3 className="gc-detail-name">{detail.name}</h3>
                  <p className="gc-detail-seed muted">
                    {detail.seed_question ? `开场：${detail.seed_question}` : '共享时间线'}
                  </p>
                </div>
              </div>
              <div className="gc-member-bar">
                {members.map((m) => {
                  const speaking = liveSpeakerId === Number(m.agent_id)
                  return (
                    <button
                      key={m.agent_id}
                      type="button"
                      className={`gc-member-chip${speaking ? ' speaking' : ''}`}
                      title={m.group_tag ? `标签：${m.group_tag}` : '点击编辑标签 / 转让'}
                      onClick={() => openMemberMenu(m)}
                    >
                      <JellyAvatar
                        color={resolveJellyColor({ jelly_color: m.jelly_color })}
                        size={22}
                        state={speaking ? 'typing' : 'idle'}
                      />
                      <span className="gc-member-name">
                        {m.name || `#${m.agent_id}`}
                        {m.role === 'owner' ? ' · 群主' : ''}
                        {m.group_tag ? ' · 标' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
              {memberMenu && (
                <div className="gc-member-panel">
                  <div className="gc-member-panel-head">
                    <strong>{memberMenu.name || `#${memberMenu.agent_id}`}</strong>
                    <button type="button" className="gc-refresh" onClick={() => setMemberMenu(null)}>关闭</button>
                  </div>
                  <label className="gc-tag-label">
                    群内标签（有则覆盖原提示词+技能）
                    <textarea
                      rows={3}
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      placeholder="例如：本群只负责前端评审"
                      disabled={memberBusy}
                    />
                  </label>
                  <div className="gc-member-panel-actions">
                    <button type="button" className="gc-meet-btn" onClick={saveTag} disabled={memberBusy}>
                      保存标签
                    </button>
                    {memberMenu.role !== 'owner' && (
                      <button type="button" className="gc-transfer-btn" onClick={transferOwner} disabled={memberBusy}>
                        设为群主
                      </button>
                    )}
                  </div>
                </div>
              )}
            </header>

            <div className="gc-timeline chatbox ma-chatbox" ref={boxRef}>
              {timeline.length === 0 && !busy && (
                <p className="empty-chat">时间线还是空的；在下方发言或 @ 成员</p>
              )}
              {timeline.map((m) => {
                const member = m.speakerAgentId ? memberById.get(m.speakerAgentId) : null
                const label = m.role === 'user'
                  ? '你'
                  : (m.speakerName || member?.name || (m.role === 'assistant' ? '同事' : m.role))
                return (
                  <div
                    key={m.key}
                    className={`msg ${m.role === 'user' ? 'user' : 'assistant'} ${m.role !== 'user' ? 'ma-flat' : ''}`}
                  >
                    <div className="msg-label">
                      <span className="gc-speaker-label">
                        {m.role !== 'user' && (
                          <JellyAvatar
                            className="ma-msg-jelly"
                            color={resolveJellyColor({ jelly_color: member?.jelly_color })}
                            size={20}
                            state={m.streaming ? 'typing' : 'idle'}
                          />
                        )}
                        <span className="gc-speaker-name">{label}</span>
                      </span>
                    </div>
                    {m.role === 'user' ? (
                      <div className="msg-body">{m.content}</div>
                    ) : (
                      <div className="msg-body msg-body-flat">
                        {m.content
                          ? <AgentMarkdown content={m.content} />
                          : (m.streaming ? <span className="ma-thinking">发言中…</span> : null)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="gc-composer ma-composer-wrap">
              {mentionOpen && members.length > 0 && (
                <ul className="gc-mention-list ma-mention-list">
                  {members.map((m, i) => (
                    <li key={m.agent_id}>
                      <button
                        type="button"
                        className={i === mentionIdx ? 'active' : ''}
                        onMouseDown={(e) => { e.preventDefault(); insertMention(m) }}
                      >
                        <JellyAvatar
                          color={resolveJellyColor({ jelly_color: m.jelly_color })}
                          size={18}
                          state="idle"
                        />
                        <span>{m.name || `#${m.agent_id}`}</span>
                        {m.role === 'owner' ? <span className="muted">群主</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                ref={composerRef}
                rows={3}
                value={draft}
                onChange={onDraftChange}
                onKeyDown={onComposerKey}
                placeholder={busy ? '进行中…可点下方停止' : '群内发言；@ 点名成员；Ctrl/⌘+Enter 发送'}
                disabled={busy}
              />
              <div className="gc-composer-actions">
                {busy ? (
                  <button type="button" className="gc-meet-stop" onClick={stopBusy}>停止</button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    onClick={sendAsk}
                    disabled={!draft.trim()}
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
