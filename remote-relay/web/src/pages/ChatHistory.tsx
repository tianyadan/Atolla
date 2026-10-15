import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  askAgent,
  clearToken,
  clearViewerPresence,
  decidePermission,
  fetchAgents,
  fetchMessages,
  fetchPendingPermissions,
  fetchTasks,
  setAgentAutoApproveAll,
  setAgentAutoReview,
  setAgentTaskPlan,
  setViewerPresence,
  stopAgent,
  syncMessages,
  type PublicMirrorAgent,
  type PublicMirrorMessage,
  type PublicMirrorPermission,
  type PublicMirrorTask,
} from '../api'
import { CmdBlock } from '../components/CmdBlock'
import { ContextRing } from '../components/ContextRing'
import { MarkdownBody } from '../components/MarkdownBody'
import { Modal } from '../components/Modal'
import { PageShell } from '../components/PageShell'
import { byLabel, parseCommandMessage } from '../utils/commandMessage'
import { loadChatDraft, saveChatDraft } from '../utils/draftCache'
import {
  agentAutoApproveAll,
  agentAutoReview,
  agentAvatarUrl,
  agentBusy,
  agentContextUsage,
  agentStatusLabel,
  agentTaskPlanEnabled,
} from '../utils/agentStatus'

/** Copy plain text (clipboard API with fallback) */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** Seconds left until permission deadline */
function remainSec(deadline: string | null | undefined): number {
  if (!deadline) return 0
  const t = Date.parse(deadline)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.ceil((t - Date.now()) / 1000))
}

/** Mirror read + sync.messages cadence while chat is open */
const POLL_MS = 4_000
/** Heartbeat so PC can show mobile_viewing icon (~60s Mac TTL) */
const VIEWER_HEARTBEAT_MS = 25_000
/** Initial / poll window of newest messages */
const PAGE_SIZE = 20
/** Ask Mac to sync a bit more into mirror than UI shows */
const SYNC_LIMIT = 40

type LocalBubble = PublicMirrorMessage & { pending?: boolean; failed?: boolean }

/** Sort ascending for chat UI */
function sortMessages(list: LocalBubble[]): LocalBubble[] {
  return [...list].sort((a, b) => {
    const ta = a.created_at ?? 0
    const tb = b.created_at ?? 0
    if (ta !== tb) return ta - tb
    return a.message_id.localeCompare(b.message_id)
  })
}

/** Merge server page into local list without dropping older loaded history */
function mergeServerMessages(prev: LocalBubble[], page: PublicMirrorMessage[]): LocalBubble[] {
  const byId = new Map<string, LocalBubble>()
  for (const m of prev) {
    if (!m.pending) byId.set(m.message_id, m)
  }
  for (const m of page) {
    const prevRow = byId.get(m.message_id)
    byId.set(m.message_id, { ...prevRow, ...m, pending: false, failed: false })
  }
  const pending = prev.filter(
    (m) =>
      m.pending &&
      !m.failed &&
      !page.some((s) => s.role === 'user' && s.content === m.content) &&
      !byId.has(m.message_id),
  )
  return sortMessages([...byId.values(), ...pending])
}

/** Chat with sticky agent header, bottom-anchored thread, older-on-scroll-up */
export function ChatHistoryPage() {
  const { instanceId = '', agentId = '' } = useParams()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<PublicMirrorAgent | null>(null)
  const [messages, setMessages] = useState<LocalBubble[]>([])
  const [tasks, setTasks] = useState<PublicMirrorTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  /** Restore unsaved composer draft for this agent (sessionStorage) */
  const [question, setQuestion] = useState(() => loadChatDraft(instanceId, agentId))
  const [sending, setSending] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [approveSettingsOpen, setApproveSettingsOpen] = useState(false)
  const [autoReviewBusy, setAutoReviewBusy] = useState(false)
  const [approveAllBusy, setApproveAllBusy] = useState(false)
  const [permQueue, setPermQueue] = useState<PublicMirrorPermission[]>([])
  const [permBusy, setPermBusy] = useState(false)
  const [, setTick] = useState(0)
  /** Waiting for AI reply after send / while engine busy on last user turn */
  const [awaitingReply, setAwaitingReply] = useState(false)
  const [kbdInset, setKbdInset] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const threadRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const loadingOlderRef = useRef(false)
  /** Only seed hasMoreOlder from the first newest-page fetch */
  const olderSeededRef = useRef(false)
  const followUpTimersRef = useRef<number[]>([])
  /** 本机已点裁决的 request_id，短时忽略镜像回灌，避免弹窗反复出现 */
  const decidedIdsRef = useRef<Set<string>>(new Set())
  const awaitSinceRef = useRef(0)

  const agentsPath = `/instances/${encodeURIComponent(instanceId)}/agents`

  /** Reload draft when route agent changes */
  useEffect(() => {
    setQuestion(loadChatDraft(instanceId, agentId))
  }, [instanceId, agentId])

  /** Persist unsaved input so accidental back doesn't lose draft */
  useEffect(() => {
    saveChatDraft(instanceId, agentId, question)
  }, [instanceId, agentId, question])

  /** Shared auth / unlock redirect */
  function handleApiError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : '请求失败'
    const status = (err as { status?: number })?.status
    if (msg.includes('Unauthorized') || status === 401) {
      clearToken()
      navigate('/login', { replace: true })
      return true
    }
    if (status === 403 || msg.includes('实例密码')) {
      navigate('/instances', { replace: true })
      return true
    }
    return false
  }

  /** Scroll thread to latest message (anchor at bottom) */
  function scrollThreadToBottom(behavior: ScrollBehavior = 'auto') {
    const anchor = bottomRef.current
    if (anchor) {
      anchor.scrollIntoView({ block: 'end', behavior })
      return
    }
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  /** After paint: stay on latest when entering / sending / new replies */
  useLayoutEffect(() => {
    if (!stickToBottomRef.current || loadingOlderRef.current) return
    scrollThreadToBottom('auto')
  }, [messages, loading, awaitingReply])

  /** Lift composer above soft keyboard via visualViewport */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKbdInset(inset)
      if (inset > 0 && stickToBottomRef.current) {
        requestAnimationFrame(() => scrollThreadToBottom('auto'))
      }
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  /** Clear awaiting when a fresh assistant reply lands */
  useEffect(() => {
    if (!awaitingReply) return
    const since = awaitSinceRef.current
    const hasReply = messages.some(
      (m) =>
        m.role === 'assistant' &&
        !m.pending &&
        (m.created_at ?? 0) >= since - 8_000,
    )
    if (hasReply) setAwaitingReply(false)
  }, [messages, awaitingReply])

  /** Refresh agent / tasks / newest message page */
  const refresh = useCallback(async () => {
    if (!instanceId || !agentId) return
    try {
      const [agents, page, taskList] = await Promise.all([
        fetchAgents(instanceId),
        fetchMessages(instanceId, agentId, { limit: PAGE_SIZE }),
        fetchTasks(instanceId, agentId),
      ])
      const found = agents.find((a) => a.agent_id === agentId) ?? null
      setAgent(found)
      setTasks(taskList)
      if (!olderSeededRef.current) {
        olderSeededRef.current = true
        setHasMoreOlder(page.has_more)
      }
      setMessages((prev) => mergeServerMessages(prev, page.messages))
      setError(null)
    } catch (err) {
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [instanceId, agentId, navigate])

  /** Prefetch older messages when user scrolls near top */
  const loadOlder = useCallback(async () => {
    if (!instanceId || !agentId || loadingOlderRef.current || !hasMoreOlder) return
    const oldest = messages.find((m) => !m.pending)
    if (!oldest) return

    const el = threadRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const prevTop = el?.scrollTop ?? 0

    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const page = await fetchMessages(instanceId, agentId, {
        limit: PAGE_SIZE,
        before_id: oldest.message_id,
      })
      setHasMoreOlder(page.has_more)
      if (page.messages.length === 0) return
      setMessages((prev) => mergeServerMessages(prev, page.messages))
      requestAnimationFrame(() => {
        const node = threadRef.current
        if (!node) return
        node.scrollTop = node.scrollHeight - prevHeight + prevTop
      })
    } catch (err) {
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '加载历史失败')
      }
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [instanceId, agentId, hasMoreOlder, messages, navigate])

  /** Enqueue Mac→relay message sync then read mirror (needed: mirror is not live SSE) */
  const syncThenRefresh = useCallback(async () => {
    if (!instanceId || !agentId) return
    try {
      await syncMessages(instanceId, agentId, { limit: SYNC_LIMIT })
    } catch {
      /* offline Mac: still try mirror read */
    }
    await refresh()
  }, [instanceId, agentId, refresh])

  useEffect(() => {
    if (!instanceId || !agentId) return
    let cancelled = false
    setLoading(true)
    setMessages([])
    setPermQueue([])
    setHasMoreOlder(false)
    olderSeededRef.current = false
    stickToBottomRef.current = true
    void (async () => {
      if (!cancelled) await syncThenRefresh()
    })()
    // Keep pulling Mac messages into the mirror while this chat is open.
    const poll = window.setInterval(() => {
      if (!cancelled) void syncThenRefresh()
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      followUpTimersRef.current.forEach((id) => window.clearTimeout(id))
      followUpTimersRef.current = []
    }
  }, [instanceId, agentId, syncThenRefresh])

  /** Report phone viewing presence to Mac (PC shows mobile_viewing icon) */
  useEffect(() => {
    if (!instanceId || !agentId) return
    let cancelled = false
    const beat = () => {
      if (cancelled) return
      void setViewerPresence(instanceId, agentId).catch(() => {
        /* Mac offline: ignore */
      })
    }
    beat()
    const hb = window.setInterval(beat, VIEWER_HEARTBEAT_MS)
    return () => {
      cancelled = true
      window.clearInterval(hb)
      void clearViewerPresence(instanceId, agentId).catch(() => {
        /* ignore */
      })
    }
  }, [instanceId, agentId])

  /** Poll pending permission cards (Mac → relay mirror) */
  const refreshPerms = useCallback(async () => {
    if (!instanceId || !agentId) return
    try {
      const items = await fetchPendingPermissions(instanceId, agentId)
      const decided = decidedIdsRef.current
      // 服务端已无的 id 从本机黑名单清掉
      for (const id of [...decided]) {
        if (!items.some((p) => p.request_id === id)) decided.delete(id)
      }
      setPermQueue(items.filter((p) => !decided.has(p.request_id)))
    } catch (err) {
      if (!handleApiError(err)) {
        /* keep last queue; transient offline is ok */
      }
    }
  }, [instanceId, agentId, navigate])

  useEffect(() => {
    if (!instanceId || !agentId) return
    let cancelled = false
    void (async () => {
      if (!cancelled) await refreshPerms()
    })()
    const poll = window.setInterval(() => {
      if (!cancelled) void refreshPerms()
    }, POLL_MS)
    const tick = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [instanceId, agentId, refreshPerms])

  /** Track whether user is near bottom; trigger older load near top */
  function onThreadScroll() {
    const el = threadRef.current
    if (!el) return
    const distanceBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceBottom < 80
    if (el.scrollTop < 48) void loadOlder()
  }

  const taskPlanOn = agentTaskPlanEnabled(agent?.payload)
  const autoReviewOn = agentAutoReview(agent?.payload)
  const approveAllOn = agentAutoApproveAll(agent?.payload)
  const busy = agentBusy(agent?.status)
  const pendingPerm = permQueue[0] ?? null
  const pendingMore = Math.max(0, permQueue.length - 1)

  const activeTask = useMemo(() => {
    const running = tasks.find((t) => {
      const s = String(t.status || '').toLowerCase()
      return s === 'running' || s === 'in_progress' || s === 'active' || s === 'busy'
    })
    return running || tasks[0] || null
  }, [tasks])

  const activeProgress = Math.min(
    100,
    Math.max(0, Number(activeTask?.payload?.progress ?? 0) || 0),
  )

  const activeSteps: string[] = useMemo(() => {
    const raw = activeTask?.payload?.steps
    if (Array.isArray(raw)) return raw.map((s) => String(s))
    const message = String(activeTask?.payload?.message || '')
    return message ? [message] : []
  }, [activeTask])

  /** Send or interrupt — pin to bottom */
  async function onSend() {
    const q = question.trim()
    if (!q || sending) return
    setSending(true)
    setError(null)
    stickToBottomRef.current = true
    awaitSinceRef.current = Date.now()
    setAwaitingReply(true)
    const optimistic: LocalBubble = {
      message_id: `local-${Date.now()}`,
      agent_id: agentId,
      role: 'user',
      content: q,
      payload: {},
      created_at: Date.now(),
      synced_at: Date.now(),
      pending: true,
    }
    setMessages((prev) => sortMessages([...prev, optimistic]))
    setQuestion('')
    saveChatDraft(instanceId, agentId, '')
    try {
      await askAgent(instanceId, agentId, q)
      // Immediate + delayed syncs: ask returns before Mac finishes the reply.
      await syncThenRefresh()
      followUpTimersRef.current.forEach((id) => window.clearTimeout(id))
      followUpTimersRef.current = [2_000, 6_000, 12_000].map((ms) =>
        window.setTimeout(() => void syncThenRefresh(), ms),
      )
    } catch (err) {
      setAwaitingReply(false)
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '发送失败')
        setMessages((prev) =>
          prev.map((m) =>
            m.message_id === optimistic.message_id ? { ...m, failed: true, pending: false } : m,
          ),
        )
      }
    } finally {
      setSending(false)
    }
  }

  /** Copy assistant reply body */
  async function onCopyMessage(id: string, text: string) {
    const t = text.trim()
    if (!t) return
    await copyText(t)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600)
  }

  /** Toggle task plan on Mac */
  async function onTogglePlan(next: boolean) {
    if (!agent || planBusy) return
    setPlanBusy(true)
    try {
      await setAgentTaskPlan(instanceId, agentId, next)
      setAgent({
        ...agent,
        payload: { ...agent.payload, task_plan_enabled: next },
      })
    } catch (err) {
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '切换失败')
      }
    } finally {
      setPlanBusy(false)
    }
  }

  /** Stop current run */
  async function onStop() {
    try {
      await stopAgent(instanceId, agentId)
      await refresh()
    } catch (err) {
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '终止失败')
      }
    }
  }

  /** Toggle「自动审核」on Mac */
  async function onToggleAutoReview(next: boolean) {
    if (!agent || autoReviewBusy || approveAllOn) return
    setAutoReviewBusy(true)
    try {
      await setAgentAutoReview(instanceId, agentId, next)
      setAgent({
        ...agent,
        payload: { ...agent.payload, auto_review: next },
      })
    } catch (err) {
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '自动审核开关失败')
      }
    } finally {
      setAutoReviewBusy(false)
    }
  }

  /** Toggle「命令全部审批通过」on Mac */
  async function onToggleApproveAll(next: boolean) {
    if (!agent || approveAllBusy) return
    setApproveAllBusy(true)
    try {
      await setAgentAutoApproveAll(instanceId, agentId, next)
      setAgent({
        ...agent,
        payload: { ...agent.payload, auto_approve_all: next },
      })
    } catch (err) {
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '全部审批通过开关失败')
      }
    } finally {
      setApproveAllBusy(false)
    }
  }

  /** Decide a pending permission card */
  async function onDecide(behavior: 'allow' | 'deny' | 'allow_session') {
    if (!pendingPerm || permBusy) return
    const rid = pendingPerm.request_id
    setPermBusy(true)
    // 先出队再请求，避免等待 enqueue 时轮询又弹回来
    decidedIdsRef.current.add(rid)
    setPermQueue((q) => q.filter((p) => p.request_id !== rid))
    try {
      await decidePermission(instanceId, agentId, rid, behavior)
    } catch (err) {
      decidedIdsRef.current.delete(rid)
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '授权失败')
        void refreshPerms()
      }
    } finally {
      setPermBusy(false)
    }
  }

  const title = agent?.display_name || agentId || '对话'
  const agentAvatar = agentAvatarUrl(agent?.payload)
  const ctxUsage = agentContextUsage(agent?.payload)
  const lastSpeak = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const r = messages[i]?.role
      if (r === 'user' || r === 'assistant') return r
    }
    return null
  }, [messages])
  /** ChatGPT-like thinking row while waiting for the next assistant turn */
  const showThinking = awaitingReply || (busy && lastSpeak === 'user')

  return (
    <PageShell title={title} backTo={agentsPath} bodyClassName="page-body-chat">
      <div className="chat-layout" style={{ ['--kbd-inset' as string]: `${kbdInset}px` }}>
        <div className="chat-sticky-top">
          <div className="chat-header-card">
            <img className="agent-avatar lg" src={agentAvatar} alt="" />
            <div className="chat-header-meta">
              <div className="list-title">{title}</div>
              <span className={`status-pill compact ${busy ? 'busy' : 'idle'}`}>
                {agentStatusLabel(agent?.status)}
              </span>
            </div>
          </div>

          {taskPlanOn ? (
            <button
              type="button"
              className="progress-strip"
              onClick={() => setProgressOpen(true)}
            >
              <div className="progress-strip-label">
                {activeTask
                  ? String(activeTask.payload?.task_name || activeTask.task_id)
                  : '暂无进行中的任务'}
                {activeTask ? ` · ${activeProgress}%` : ''}
              </div>
              <div className="agent-progress-bar">
                <div style={{ width: `${activeTask ? activeProgress : 0}%` }} />
              </div>
            </button>
          ) : null}

          {error ? <p className="error-banner">{error}</p> : null}
        </div>

        <div
          className="chat-thread"
          ref={threadRef}
          onScroll={onThreadScroll}
        >
          {loadingOlder ? <p className="muted chat-thread-hint">加载更早消息…</p> : null}
          {!loadingOlder && hasMoreOlder ? (
            <p className="muted chat-thread-hint">上滑加载更早消息</p>
          ) : null}
          {!loadingOlder && !hasMoreOlder && messages.length > 0 ? (
            <p className="muted chat-thread-hint">没有更早的消息了</p>
          ) : null}
          {loading ? <p className="muted chat-thread-hint">加载中…</p> : null}
          {!loading && messages.length === 0 ? (
            <p className="muted chat-thread-hint">暂无消息，发送一条开始对话</p>
          ) : null}
          {messages.map((m) => {
            const role = m.role ?? 'unknown'
            const isUser = role === 'user'
            const isAssistant = role === 'assistant'
            const isCommand = role === 'command'
            const isAuto = role === 'auto'
            const isSystem = role === 'system'
            const isStatus = role === 'status'
            const isInvokeQuote = role === 'invoke_quote'
            const isInvokeDivider = role === 'invoke_divider'
            const isSpecial =
              isCommand || isAuto || isSystem || isStatus || isInvokeQuote || isInvokeDivider
            const cmd = isCommand ? parseCommandMessage(m.content, m.payload) : null
            const label = isUser
              ? '你'
              : isAssistant
                ? title
                : isCommand
                  ? cmd?.decision === 'deny'
                    ? '已拒绝命令'
                    : '已执行命令'
                  : isAuto
                    ? '自动审核'
                    : isSystem
                      ? '系统'
                      : isStatus
                        ? '状态'
                        : isInvokeQuote
                          ? `引用 · ${String(m.payload?.callee_name || '同事')}`
                          : isInvokeDivider
                            ? '调用记录'
                            : role || '消息'

            return (
              <article
                key={m.message_id}
                className={`chat-bubble role-${role}${isUser ? ' bubble-user' : ''}${isAssistant ? ' bubble-assistant' : ''}${isSpecial ? ' bubble-special' : ''}${isCommand ? ' bubble-command' : ''}${m.failed ? ' failed' : ''}${m.pending ? ' pending' : ''}`}
              >
                <header className={isAssistant ? 'bubble-agent-head' : undefined}>
                  {isAssistant ? (
                    <>
                      <img className="bubble-agent-avatar" src={agentAvatar} alt="" />
                      <span className="bubble-agent-name">{label}</span>
                      <button
                        type="button"
                        className="bubble-copy"
                        onClick={() => void onCopyMessage(m.message_id, m.content || '')}
                      >
                        {copiedId === m.message_id ? '已复制' : '复制'}
                      </button>
                    </>
                  ) : (
                    <>
                      <span>{label}</span>
                      {isCommand && cmd?.by ? (
                        <span className="cmd-by">{byLabel(cmd.by)}</span>
                      ) : null}
                      {m.failed ? ' · 发送失败' : m.pending ? ' · 发送中' : ''}
                    </>
                  )}
                </header>
                {isCommand ? (
                  <CmdBlock content={m.content} payload={m.payload} />
                ) : isAuto ? (
                  <div className="auto-trace">
                    {String(m.payload?.note || 'AI 已自动放行')}{' '}
                    <code>{m.content || ''}</code>
                  </div>
                ) : isSystem ? (
                  <div className="system-note">{m.content || ''}</div>
                ) : isStatus ? (
                  <pre className="status-snap">{m.content || ''}</pre>
                ) : isInvokeDivider ? (
                  <div className="divider-msg">{m.content || ''}</div>
                ) : isInvokeQuote ? (
                  <details className="quote-msg">
                    <summary>{String(m.payload?.callee_name || '同事')} 的结果</summary>
                    <MarkdownBody content={m.content || ''} />
                  </details>
                ) : isAssistant ? (
                  <MarkdownBody content={m.content || ''} />
                ) : (
                  <p className="bubble-plain">{m.content || ''}</p>
                )}
              </article>
            )
          })}
          {showThinking ? (
            <article className="chat-bubble bubble-assistant bubble-thinking" aria-live="polite">
              <header className="bubble-agent-head">
                <img className="bubble-agent-avatar" src={agentAvatar} alt="" />
                <span className="bubble-agent-name">{title}</span>
              </header>
              <div className="thinking-row">
                <span className="thinking-label">正在思考</span>
                <span className="thinking-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </article>
          ) : null}
          <div ref={bottomRef} className="chat-thread-end" aria-hidden />
        </div>

        <div className="chat-composer" ref={composerRef}>
          <div className="chat-composer-toggles">
            <label className="capsule-toggle">
              <input
                type="checkbox"
                checked={taskPlanOn}
                disabled={planBusy || !agent}
                onChange={(e) => void onTogglePlan(e.target.checked)}
              />
              <span>任务规划</span>
            </label>
            <button
              type="button"
              className={`btn outline small approve-settings-btn${approveAllOn || autoReviewOn ? ' is-on' : ''}`}
              disabled={!agent}
              onClick={() => setApproveSettingsOpen(true)}
            >
              命令审批设置
              {(approveAllOn || autoReviewOn) && <span className="approve-dot" aria-hidden />}
            </button>
          </div>
          <div className="chat-composer-input-wrap">
            <textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onFocus={() => {
                stickToBottomRef.current = true
                window.setTimeout(() => scrollThreadToBottom('smooth'), 80)
              }}
              placeholder={busy ? '输入插话内容…' : '输入任务…'}
            />
            <ContextRing usage={ctxUsage} />
          </div>
          <div className="chat-composer-actions">
            <button
              type="button"
              className="btn outline small"
              disabled={!question}
              onClick={() => {
                setQuestion('')
                saveChatDraft(instanceId, agentId, '')
              }}
            >
              清空
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={sending || !question.trim()}
              onClick={() => void onSend()}
            >
              {sending ? '发送中…' : busy ? '插话' : '发送'}
            </button>
            {busy ? (
              <button type="button" className="btn danger outline" onClick={() => void onStop()}>
                终止
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={approveSettingsOpen}
        title="命令审批设置"
        onClose={() => !autoReviewBusy && !approveAllBusy && setApproveSettingsOpen(false)}
        footer={
          <button
            type="button"
            className="btn primary"
            disabled={autoReviewBusy || approveAllBusy}
            onClick={() => setApproveSettingsOpen(false)}
          >
            关闭
          </button>
        }
      >
        <p className="modal-hint">
          控制本数字人命令授权策略。Hard Deny（如关机）仍不可绕过。与 PC 管理台同步。
        </p>
        <label className="policy-row">
          <div>
            <div className="policy-label">命令全部审批通过</div>
            <p className="muted policy-hint">
              开启后无需人工审批，全部自动通过；自动通过记录写入数据库，最多保留 7 天
            </p>
          </div>
          <input
            type="checkbox"
            checked={approveAllOn}
            disabled={approveAllBusy || !agent}
            onChange={(e) => void onToggleApproveAll(e.target.checked)}
          />
        </label>
        <label className="policy-row">
          <div>
            <div className="policy-label">自动审核</div>
            <p className="muted policy-hint">开启后由 AI 审核非常规命令（仍可能弹窗）</p>
          </div>
          <input
            type="checkbox"
            checked={autoReviewOn}
            disabled={autoReviewBusy || approveAllOn || !agent}
            onChange={(e) => void onToggleAutoReview(e.target.checked)}
          />
        </label>
      </Modal>

      <Modal
        open={Boolean(pendingPerm)}
        title={
          pendingPerm
            ? `申请授权 · 剩余 ${remainSec(pendingPerm.deadline)}s`
            : '申请授权'
        }
        onClose={() => {
          /* must decide; mask click ignored while pending */
        }}
        footer={
          pendingPerm ? (
            <div className="perm-actions">
              <button
                type="button"
                className="btn danger outline"
                disabled={permBusy}
                onClick={() => void onDecide('deny')}
              >
                拒绝
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={permBusy}
                onClick={() => void onDecide('allow')}
              >
                本次允许
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={permBusy}
                onClick={() => void onDecide('allow_session')}
              >
                本次会话允许
              </button>
            </div>
          ) : null
        }
      >
        {pendingPerm ? (
          <>
            {pendingPerm.note ? <p className="modal-hint">{pendingPerm.note}</p> : null}
            <div className="perm-tool">{pendingPerm.tool_name || 'Tool'}</div>
            <CmdBlock
              content={pendingPerm.summary}
              payload={{
                command: pendingPerm.summary,
                risk: pendingPerm.risk,
                meaning: pendingPerm.meaning,
                note: pendingPerm.note,
                decision: 'ask',
              }}
            />
            {pendingMore > 0 ? <p className="muted">+{pendingMore} 条排队中</p> : null}
            <p className="muted policy-hint">
              Hard Deny 不可绕过。会话允许仅匹配规范化命令签名。超时自动拒绝。
            </p>
          </>
        ) : null}
      </Modal>

      <Modal
        open={progressOpen}
        title="任务进度"
        onClose={() => setProgressOpen(false)}
        footer={
          <button type="button" className="btn primary" onClick={() => setProgressOpen(false)}>
            关闭
          </button>
        }
      >
        {activeTask ? (
          <>
            <p className="modal-hint">
              {String(activeTask.payload?.task_name || activeTask.task_id)} · {activeProgress}%
            </p>
            <div className="agent-progress-bar">
              <div style={{ width: `${activeProgress}%` }} />
            </div>
            {activeSteps.length > 0 ? (
              <ol className="progress-steps">
                {activeSteps.map((s, i) => (
                  <li key={`${i}-${s}`}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="muted">{String(activeTask.payload?.message || '暂无步骤详情')}</p>
            )}
          </>
        ) : (
          <p className="muted">暂无进行中的任务</p>
        )}
      </Modal>
    </PageShell>
  )
}
