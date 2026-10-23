import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
  uploadChatImage,
  type PublicMirrorAgent,
  type PublicMirrorMessage,
  type PublicMirrorPermission,
  type PublicMirrorTask,
} from '../api'
import { AgentSettingsSheet } from '../components/AgentSettingsSheet'
import { CmdBlock } from '../components/CmdBlock'
import { ContextRing } from '../components/ContextRing'
import { MarkdownBody } from '../components/MarkdownBody'
import { Modal } from '../components/Modal'
import { PageShell } from '../components/PageShell'
import { SettingsIcon } from '../components/SettingsIcon'
import { byLabel, parseCommandMessage } from '../utils/commandMessage'
import { useUnlockHeartbeat } from '../hooks/useUnlockHeartbeat'
import { loadChatDraft, saveChatDraft } from '../utils/draftCache'
import {
  appendPendingImages,
  attachmentsFromPayload,
  blobToBase64,
  compressImageFile,
  MAX_CHAT_IMAGES,
  revokePendingImages,
  type PendingImage,
} from '../utils/chatImages'
import { ChatThinkingTip } from '../components/ChatThinkingTip'
import {
  ClearIcon,
  ImageIcon,
  SendIcon,
  StopIcon,
} from '../components/ComposerIcons'
import { EngineTag } from '../components/EngineTag'
import { EngineUsageChip } from '../components/EngineUsageChip'
import {
  loadChatHeaderExpanded,
  saveChatHeaderExpanded,
} from '../utils/chatHeaderCollapse'
import { syncIslandOptimisticAgent } from '../islandLiveActivity'
import { invalidateIslandSync } from '../islandSyncInvalidation'
import { JellyAvatar } from '../jelly/JellyAvatar'
import { jellyStateFromAgent, resolveMirrorJellyColor } from '../jelly/jellyColor'
import {
  agentAutoApproveAll,
  agentAutoReview,
  agentBusy,
  agentContextUsage,
  agentRunStartedAt,
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
  const [searchParams] = useSearchParams()
  const approvalRequestId = searchParams.get('approval_request_id') || ''
  useUnlockHeartbeat(instanceId || undefined)
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
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)
  const [autoReviewBusy, setAutoReviewBusy] = useState(false)
  const [approveAllBusy, setApproveAllBusy] = useState(false)
  const [permQueue, setPermQueue] = useState<PublicMirrorPermission[]>([])
  const [permBusy, setPermBusy] = useState(false)
  const [, setTick] = useState(0)
  /** Waiting for AI reply after send / while engine busy on last user turn */
  const [awaitingReply, setAwaitingReply] = useState(false)
  const [kbdInset, setKbdInset] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [lightboxSrc, setLightboxSrc] = useState('')
  /** Album / screenshot picker (no capture) */
  const albumInputRef = useRef<HTMLInputElement | null>(null)
  /** 顶栏展开；默认展开，localStorage 记住 */
  const [headerExpanded, setHeaderExpanded] = useState(() => loadChatHeaderExpanded())

  /** 切换顶栏展开并持久化 */
  function toggleHeaderExpanded() {
    setHeaderExpanded((prev) => {
      const next = !prev
      saveChatHeaderExpanded(next)
      return next
    })
  }

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
  /** 发送前已经在列表里的助手消息，避免把上一轮回复当成这一轮的完成。 */
  const replySeenRef = useRef<Set<string>>(new Set())
  const awaitingRef = useRef(false)

  const agentsPath = `/instances/${encodeURIComponent(instanceId)}/agents`

  /** Reload draft when route agent changes; clear pending images */
  useEffect(() => {
    setQuestion(loadChatDraft(instanceId, agentId))
    setPendingImages((prev) => {
      revokePendingImages(prev)
      return []
    })
  }, [instanceId, agentId])

  useEffect(() => {
    return () => {
      setPendingImages((prev) => {
        revokePendingImages(prev)
        return prev
      })
    }
  }, [])

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

  /**
   * 输入框抬到软键盘上方：
   * - Capacitor 原生：keyboardWillShow 高度最准（全面屏 + resize:none）
   * - 浏览器：visualViewport 兜底
   */
  useEffect(() => {
    let cancelled = false
    let useNative = false
    const applyInset = (px: number) => {
      if (cancelled) return
      const inset = Math.max(0, Math.round(px))
      setKbdInset(inset)
      if (inset > 0 && stickToBottomRef.current) {
        requestAnimationFrame(() => scrollThreadToBottom('auto'))
      }
    }

    const handles: { remove: () => void }[] = []

    if (Capacitor.isNativePlatform()) {
      useNative = true
      void Keyboard.addListener('keyboardWillShow', (info) => {
        applyInset(info.keyboardHeight)
      }).then((h) => handles.push(h))
      void Keyboard.addListener('keyboardWillHide', () => {
        applyInset(0)
      }).then((h) => handles.push(h))
    }

    const vv = window.visualViewport
    const onVv = () => {
      if (useNative || !vv) return
      applyInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    if (!useNative) {
      vv?.addEventListener('resize', onVv)
      vv?.addEventListener('scroll', onVv)
      onVv()
    }

    return () => {
      cancelled = true
      handles.forEach((h) => h.remove())
      vv?.removeEventListener('resize', onVv)
      vv?.removeEventListener('scroll', onVv)
    }
  }, [])

  /** 同步给刷新回调：等待回复期间，空闲镜像不能把状态盖回「闲」。 */
  awaitingRef.current = awaitingReply

  /** 只认发送之后新出现的助手消息。 */
  useEffect(() => {
    if (!awaitingReply) return
    const seen = replySeenRef.current
    const hasReply = messages.some(
      (m) => m.role === 'assistant' && !m.pending && !seen.has(m.message_id),
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
      setAgent(() => {
        if (!found) return found
        // 镜像还是上一轮的 idle 时，本机已发出的消息仍应显示忙碌。
        if (awaitingRef.current && !agentBusy(found.status)) {
          return { ...found, status: 'running' }
        }
        return found
      })
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
      // 锁屏或切到后台视为离开对话，允许 Bark；回到前台再上报
      if (document.visibilityState === 'hidden') {
        void clearViewerPresence(instanceId, agentId).catch(() => {})
        return
      }
      void setViewerPresence(instanceId, agentId)
        .then(() => invalidateIslandSync())
        .catch(() => {
          /* Mac offline: ignore */
        })
    }
    beat()
    const hb = window.setInterval(beat, VIEWER_HEARTBEAT_MS)
    document.addEventListener('visibilitychange', beat)
    return () => {
      cancelled = true
      window.clearInterval(hb)
      document.removeEventListener('visibilitychange', beat)
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
      const available = items.filter((p) => !decided.has(p.request_id))
      if (approvalRequestId) {
        const targetIndex = available.findIndex((p) => p.request_id === approvalRequestId)
        if (targetIndex >= 0) {
          const target = available[targetIndex]
          setPermQueue([target, ...available.filter((_, index) => index !== targetIndex)])
        } else {
          setPermQueue(available)
          setError('该审批已处理或已过期')
        }
      } else {
        setPermQueue(available)
      }
    } catch (err) {
      if (!handleApiError(err)) {
        /* keep last queue; transient offline is ok */
      }
    }
  }, [approvalRequestId, instanceId, agentId, navigate])

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
  const busy = agentBusy(agent?.status) || awaitingReply
  const pendingPerm = permQueue[0] ?? null
  const pendingMore = Math.max(0, permQueue.length - 1)

  /** 对话中忙碌 / 等待回复时立刻上岛（不必回到列表） */
  useEffect(() => {
    if (!agent) return
    if (!busy) return
    void syncIslandOptimisticAgent(agent, { forceBusy: true, instanceId })
  }, [agent, busy, awaitingReply, instanceId])

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

  /** Pick images from album / camera */
  function onPickImages(files: FileList | null) {
    if (!files?.length) return
    const { next, overflow } = appendPendingImages(pendingImages, Array.from(files))
    setPendingImages(next)
    if (overflow) setError(`最多附带 ${MAX_CHAT_IMAGES} 张图片`)
  }

  /** Remove one pending preview before send */
  function onRemovePending(localId: string) {
    setPendingImages((prev) => {
      const target = prev.find((p) => p.localId === localId)
      if (target) revokePendingImages([target])
      return prev.filter((p) => p.localId !== localId)
    })
  }

  /** Compress + upload pending images, then ask with attachments */
  async function ensureUploaded(items: PendingImage[]) {
    const out: { id: string; url: string; mime: string; name: string }[] = []
    for (const it of items) {
      if (it.uploaded?.url || it.uploaded?.id) {
        out.push(it.uploaded)
        continue
      }
      setPendingImages((prev) =>
        prev.map((p) => (p.localId === it.localId ? { ...p, uploading: true, error: '' } : p)),
      )
      try {
        const blob = await compressImageFile(it.file)
        const b64 = await blobToBase64(blob)
        const name = (it.file.name || 'mobile.jpg').replace(/\.[^.]+$/, '') + '.jpg'
        const att = await uploadChatImage(instanceId, agentId, b64, name)
        setPendingImages((prev) =>
          prev.map((p) =>
            p.localId === it.localId ? { ...p, uploading: false, uploaded: att } : p,
          ),
        )
        out.push(att)
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传失败'
        setPendingImages((prev) =>
          prev.map((p) =>
            p.localId === it.localId ? { ...p, uploading: false, error: msg } : p,
          ),
        )
        throw err
      }
    }
    return out
  }

  /** Send or interrupt — pin to bottom */
  async function onSend() {
    const q = question.trim()
    if (sending) return
    if (!q && pendingImages.length === 0) return
    setSending(true)
    setError(null)
    stickToBottomRef.current = true
    awaitSinceRef.current = Date.now()
    replySeenRef.current = new Set(
      messages.filter((m) => m.role === 'assistant' && !m.pending).map((m) => m.message_id),
    )
    awaitingRef.current = true
    setAwaitingReply(true)
    setAgent((prev) => (prev ? { ...prev, status: 'running' } : prev))
    const optimisticId = `local-${Date.now()}`
    try {
      const atts = await ensureUploaded(pendingImages)
      const displayQ = q || (atts.length ? '请查看图片' : '')
      const optimistic: LocalBubble = {
        message_id: optimisticId,
        agent_id: agentId,
        role: 'user',
        content: displayQ,
        payload: atts.length ? { attachments: atts } : {},
        created_at: Date.now(),
        synced_at: Date.now(),
        pending: true,
      }
      setMessages((prev) => sortMessages([...prev, optimistic]))
      setQuestion('')
      saveChatDraft(instanceId, agentId, '')
      revokePendingImages(pendingImages)
      setPendingImages([])
      await askAgent(instanceId, agentId, q, atts)
      await syncThenRefresh()
      followUpTimersRef.current.forEach((id) => window.clearTimeout(id))
      followUpTimersRef.current = [2_000, 6_000, 12_000].map((ms) =>
        window.setTimeout(() => void syncThenRefresh(), ms),
      )
    } catch (err) {
      awaitingRef.current = false
      setAwaitingReply(false)
      if (!handleApiError(err)) {
        setError(err instanceof Error ? err.message : '发送失败')
        setMessages((prev) =>
          prev.map((m) =>
            m.message_id === optimisticId ? { ...m, failed: true, pending: false } : m,
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
      invalidateIslandSync()
      if (approvalRequestId === rid) {
        navigate(
          `/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/chat`,
          { replace: true },
        )
      }
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
  const jellyColor = resolveMirrorJellyColor(agent)
  const jellyState = jellyStateFromAgent(agent, {
    loading: awaitingReply,
    streaming: awaitingReply,
  })
  const ctxUsage = agentContextUsage(agent?.payload)
  return (
    <PageShell title={title} backTo={agentsPath} bodyClassName="page-body-chat">
      <div className="chat-layout" style={{ ['--kbd-inset' as string]: `${kbdInset}px` }}>
        <div className={`chat-sticky-top${headerExpanded ? '' : ' is-collapsed'}`}>
          {headerExpanded ? (
            <>
              <div className="chat-header-card">
                <JellyAvatar
                  className="agent-avatar lg"
                  color={jellyColor}
                  size={48}
                  state={jellyState}
                />
                <div className="chat-header-meta">
                  <div className="list-title">{title}</div>
                  <div className="chat-header-tags">
                    <span className={`status-pill compact ${busy ? 'busy' : 'idle'}`}>
                      {agentStatusLabel(agent?.status)}
                    </span>
                    <EngineTag engine={agent?.engine} />
                    {instanceId ? (
                      <EngineUsageChip instanceId={instanceId} engine={agent?.engine} />
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn chat-agent-settings-btn"
                  aria-label="员工设置"
                  onClick={() => setAgentSettingsOpen(true)}
                >
                  <SettingsIcon size={22} />
                </button>
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

              <button
                type="button"
                className="chat-header-fold-tri"
                aria-label="收起状态栏"
                title="收起状态栏"
                onClick={toggleHeaderExpanded}
              >
                ▲
              </button>
            </>
          ) : (
            <>
              {error ? <p className="error-banner">{error}</p> : null}
              <button
                type="button"
                className="chat-header-fold-tri alone"
                aria-label="展开状态栏"
                title="展开状态栏"
                onClick={toggleHeaderExpanded}
              >
                ▼
              </button>
            </>
          )}
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
                      <JellyAvatar
                        className="bubble-agent-avatar"
                        color={jellyColor}
                        size={22}
                        state="idle"
                      />
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
                {(() => {
                  const imgs = attachmentsFromPayload(m.payload)
                  if (!imgs.length) return null
                  return (
                    <div className="chat-msg-images">
                      {imgs.map((a, i) =>
                        a.url ? (
                          <button
                            key={a.id || a.url || i}
                            type="button"
                            className="chat-msg-img"
                            onClick={() => setLightboxSrc(a.url)}
                          >
                            <img src={a.url} alt={a.name || ''} loading="lazy" />
                          </button>
                        ) : null,
                      )}
                    </div>
                  )
                })()}
              </article>
            )
          })}
          {/* 发送后 / 忙碌中：小水母浮动 + Claude CLI 风格 loading 文案 */}
          {busy ? (
            <ChatThinkingTip
              color={jellyColor}
              runStartedAt={
                agentRunStartedAt(agent?.payload) ??
                (awaitSinceRef.current > 0
                  ? Math.floor(awaitSinceRef.current / 1000)
                  : null)
              }
            />
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
          <div className="chat-composer-shell">
            {pendingImages.length > 0 ? (
              <div className="chat-attach-preview" aria-label="待发送图片">
                {pendingImages.map((it) => (
                  <div
                    key={it.localId}
                    className={`chat-attach-thumb${it.uploading ? ' uploading' : ''}${it.error ? ' err' : ''}`}
                  >
                    <img src={it.previewUrl} alt="" />
                    {it.uploading ? <span className="chat-attach-spin" aria-hidden /> : null}
                    {it.error ? <span className="chat-attach-err" title={it.error}>!</span> : null}
                    <button
                      type="button"
                      className="chat-attach-rm"
                      aria-label="移除图片"
                      disabled={sending}
                      onClick={() => onRemovePending(it.localId)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              rows={2}
              className="chat-composer-field"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onFocus={() => {
                stickToBottomRef.current = true
                window.setTimeout(() => scrollThreadToBottom('smooth'), 80)
              }}
              placeholder={busy ? '输入插话内容…' : '输入任务或附图…'}
            />
            <div className="chat-composer-toolbar">
              <input
                ref={albumInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  onPickImages(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="composer-icon-btn"
                aria-label="选择图片"
                title="选择图片"
                disabled={sending || pendingImages.length >= MAX_CHAT_IMAGES}
                onClick={() => albumInputRef.current?.click()}
              >
                <ImageIcon />
              </button>
              <div className="chat-composer-toolbar-spacer" />
              <ContextRing usage={ctxUsage} />
              {(question || pendingImages.length > 0) && !sending ? (
                <button
                  type="button"
                  className="composer-icon-btn"
                  aria-label="清空"
                  title="清空"
                  onClick={() => {
                    setQuestion('')
                    saveChatDraft(instanceId, agentId, '')
                    revokePendingImages(pendingImages)
                    setPendingImages([])
                  }}
                >
                  <ClearIcon />
                </button>
              ) : null}
              {busy ? (
                <button
                  type="button"
                  className="composer-icon-btn is-stop"
                  aria-label="终止"
                  title="终止"
                  onClick={() => void onStop()}
                >
                  <StopIcon />
                </button>
              ) : null}
              <button
                type="button"
                className={`composer-send-btn${busy ? ' is-interrupt' : ''}`}
                aria-label={sending ? '发送中' : busy ? '插话' : '发送'}
                title={sending ? '发送中' : busy ? '插话' : '发送'}
                disabled={sending || (!question.trim() && pendingImages.length === 0)}
                onClick={() => void onSend()}
              >
                <SendIcon />
              </button>
            </div>
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
              startExpanded
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

      <AgentSettingsSheet
        open={agentSettingsOpen}
        instanceId={instanceId}
        agentId={agentId}
        agentName={agent?.display_name ?? undefined}
        onClose={() => setAgentSettingsOpen(false)}
      />

      {lightboxSrc ? (
        <div
          className="chat-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setLightboxSrc('')}
        >
          <button
            type="button"
            className="chat-lightbox-close"
            aria-label="关闭"
            onClick={() => setLightboxSrc('')}
          >
            ×
          </button>
          <img src={lightboxSrc} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </PageShell>
  )
}
