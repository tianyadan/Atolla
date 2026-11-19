/**
 * 数字员工运行态(模块级):切换菜单/登出不丢 SSE / chatLog / 授权队列。
 */
const sessions = new Map()
const listeners = new Set()
const COMPLETION_CELEBRATION_MS = 5_000

function emptySession() {
  return {
    chatLog: [],
    loading: false,
    compressing: false,
    error: '',
    runStartedAt: 0,
    abort: null,
    pendingInterrupt: '',
    interrupting: false,
    permQueue: [],
    autoOn: false,
    totalMessages: 0,
    hasMore: false,
    loadingMore: false,
    convId: 0,
    liveActivity: null,
    liveThinking: '',
    agentPhase: '',
    runtimeDetail: null,
    lastRuntimeDetail: null,
    taskTokens: 0,
    contextUsed: 0,
    contextWindow: 0,
    contextEstimated: true, // Codex/Cursor 默认估算；Claude probe 成功后为 false
    activeTaskPlan: null, // 待确认计划跨页保留；任一客户端处理后由轮询清空
    celebrationEndsAt: 0,
    celebrationTimer: null,
  }
}

export function getAgentSession(agentId) {
  const id = Number(agentId) || 0
  if (!id) return emptySession()
  if (!sessions.has(id)) sessions.set(id, emptySession())
  return sessions.get(id)
}

export function patchAgentSession(agentId, patch) {
  const id = Number(agentId)
  if (!id) return
  const cur = getAgentSession(id)
  Object.assign(cur, patch)
  listeners.forEach((fn) => fn(id))
}

export function setAgentChatLog(agentId, chatLogOrFn) {
  const s = getAgentSession(agentId)
  const next = typeof chatLogOrFn === 'function' ? chatLogOrFn(s.chatLog) : chatLogOrFn
  patchAgentSession(agentId, { chatLog: next })
}

export function subscribeAgentSessions(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function anyAgentLoading() {
  for (const s of sessions.values()) {
    if (s.loading || s.compressing) return true
  }
  return false
}

/** 所有会话里待裁决的授权(带 agentId) */
export function allPendingPerms() {
  const out = []
  for (const [id, s] of sessions.entries()) {
    for (const p of s.permQueue || []) {
      out.push({ ...p, agentId: id })
    }
  }
  return out
}

export function clearAgentSession(agentId) {
  const id = Number(agentId)
  if (!id) return
  const s = getAgentSession(id)
  s.abort?.abort()
  if (s.celebrationTimer) clearTimeout(s.celebrationTimer)
  sessions.set(id, emptySession())
  listeners.forEach((fn) => fn(id))
}

/**
 * 正常结束后的短暂庆祝动画。
 * WHY：完成态会被轮询快速回写 idle，计时必须独立于接口刷新。
 */
export function startAgentCelebration(agentId, durationMs = COMPLETION_CELEBRATION_MS) {
  const id = Number(agentId)
  if (!id) return
  const session = getAgentSession(id)
  if (session.celebrationTimer) clearTimeout(session.celebrationTimer)
  const endsAt = Date.now() + Math.max(0, Number(durationMs) || COMPLETION_CELEBRATION_MS)
  const timer = setTimeout(() => {
    const current = getAgentSession(id)
    if (current.celebrationEndsAt !== endsAt) return
    patchAgentSession(id, { agentPhase: '', celebrationEndsAt: 0, celebrationTimer: null })
  }, Math.max(0, endsAt - Date.now()))
  patchAgentSession(id, { agentPhase: 'celebrate', celebrationEndsAt: endsAt, celebrationTimer: timer })
}

/** 新任务开始或用户终止时，取消上一轮尚未结束的庆祝动画。 */
export function clearAgentCelebration(agentId) {
  const id = Number(agentId)
  if (!id) return
  const session = getAgentSession(id)
  if (session.celebrationTimer) clearTimeout(session.celebrationTimer)
  if (session.celebrationEndsAt || session.agentPhase === 'celebrate') {
    patchAgentSession(id, {
      agentPhase: session.agentPhase === 'celebrate' ? '' : session.agentPhase,
      celebrationEndsAt: 0,
      celebrationTimer: null,
    })
  }
}

export function listSessionAgentIds() {
  return [...sessions.keys()]
}
