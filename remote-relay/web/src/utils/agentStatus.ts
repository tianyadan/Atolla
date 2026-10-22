/** Map platform status → mobile two-state label */
export function agentBusy(status: string | null | undefined): boolean {
  const s = String(status || 'idle').toLowerCase()
  return (
    s === 'running' ||
    s === 'busy' ||
    s === '插话中' ||
    s === 'initializing' ||
    s === 'compressing' ||
    s === 'waiting'
  )
}

/** 闲 / 忙（移动端状态 pill 宜短） */
export function agentStatusLabel(status: string | null | undefined): string {
  return agentBusy(status) ? '忙' : '闲'
}

/** @deprecated 上传头像已由像素水母替代；保留常量以免旧引用崩 */
export const DEFAULT_AGENT_AVATAR =
  'https://img0.baidu.com/it/u=890210585,2769039861&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=667'

/**
 * @deprecated 请改用 JellyAvatar + resolveMirrorJellyColor
 * 仍返回 URL 仅作兼容；新 UI 不再使用。
 */
export function agentAvatarUrl(payload: Record<string, unknown> | undefined): string {
  const u = String(payload?.avatar_url || '').trim()
  return u || DEFAULT_AGENT_AVATAR
}

/** Read task_plan_enabled from payload (default true) */
export function agentTaskPlanEnabled(payload: Record<string, unknown> | undefined): boolean {
  if (payload?.task_plan_enabled === false) return false
  return true
}

/** Read auto_review from payload */
export function agentAutoReview(payload: Record<string, unknown> | undefined): boolean {
  return payload?.auto_review === true
}

/** Read auto_approve_all from payload */
export function agentAutoApproveAll(payload: Record<string, unknown> | undefined): boolean {
  return payload?.auto_approve_all === true
}

export type AgentFolderGroup = {
  key: string
  title: string
  sort: number
  agents: import('../api').PublicMirrorAgent[]
}

/** Group agents by folder_id / folder_name; 未入组 first */
export function groupAgentsByFolder(
  agents: import('../api').PublicMirrorAgent[],
): AgentFolderGroup[] {
  const map = new Map<string, AgentFolderGroup>()
  for (const a of agents) {
    const folderId = Number(a.payload?.folder_id ?? 0) || 0
    const folderName = String(a.payload?.folder_name || '').trim()
    // 工作组已删除时只有 id、没有名字，归回未入组，避免多出一堆「工作组 N」。
    const grouped = folderId > 0 && folderName.length > 0
    const key = grouped ? `f:${folderId}` : 'root'
    const title = grouped ? folderName : '未入组'
    let g = map.get(key)
    if (!g) {
      g = { key, title, sort: grouped ? folderId : 0, agents: [] }
      map.set(key, g)
    }
    g.agents.push(a)
  }
  const list = [...map.values()]
  list.sort((a, b) => {
    if (a.key === 'root') return -1
    if (b.key === 'root') return 1
    return a.sort - b.sort || a.title.localeCompare(b.title, 'zh')
  })
  return list
}

/** Filter grouped agents by display_name / agent_id (case-insensitive); drop empty groups */
export function filterAgentGroupsByQuery(
  groups: AgentFolderGroup[],
  query: string,
): AgentFolderGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({
      ...g,
      agents: g.agents.filter((a) => {
        const name = String(a.display_name || '').toLowerCase()
        const id = String(a.agent_id || '').toLowerCase()
        return name.includes(q) || id.includes(q)
      }),
    }))
    .filter((g) => g.agents.length > 0)
}

export type AgentContextUsage = {
  used: number
  window: number
  estimated: boolean
  source: string
  updatedAt: number
  anomaly: string
  /** Raw percent (may exceed 100, same as PC) */
  pct: number
}

/** Read context occupancy from mirror agent payload (same fields as PC context API) */
export function agentContextUsage(
  payload: Record<string, unknown> | undefined,
): AgentContextUsage {
  const used = Number(payload?.used_tokens) || 0
  const win = Number(payload?.window_tokens) || 0
  const source = String(payload?.context_source || '').trim()
  const updatedAt = Number(payload?.context_updated_at) || 0
  const anomaly = String(payload?.anomaly || '').trim()
  const estimated =
    payload?.estimated === false
      ? false
      : payload?.estimated === true
        ? true
        : source !== 'probe' && source !== 'codex_session'
  // Prefer Mac-pushed used_percent (agent.PercentOf); fallback used/window
  const hasPct = payload != null && Object.prototype.hasOwnProperty.call(payload, 'used_percent')
  const fromPayload = Number(payload?.used_percent)
  const pct =
    hasPct && Number.isFinite(fromPayload)
      ? fromPayload
      : win > 0
        ? (used / win) * 100
        : 0
  return { used, window: win, estimated, source, updatedAt, anomaly, pct }
}

/** Ring fill ratio 0–1 (PC ContextRing caps stroke at 100%) */
export function contextRingFillRatio(usage: AgentContextUsage): number {
  return Math.min(1, Math.max(0, usage.pct / 100))
}

/**
 * Compact label inside the ring — never show 191-style overflow.
 * PC only puts percent in title; we show capped value / "!" when anomalous.
 */
export function contextRingLabel(usage: AgentContextUsage): string {
  if (usage.window <= 0) return '—'
  if (usage.pct > 100 || usage.anomaly) return '!'
  return String(Math.round(usage.pct))
}

/** Count busy agents (direct running), PC sidebar badge semantics */
export function countBusyAgents(agents: import('../api').PublicMirrorAgent[]): number {
  return agents.reduce((n, a) => n + (agentBusy(a.status) ? 1 : 0), 0)
}

/** 忙碌数字人列表（供「运行中」快捷区；可选按名称/id 过滤） */
export function listBusyAgents(
  agents: import('../api').PublicMirrorAgent[],
  query = '',
): import('../api').PublicMirrorAgent[] {
  const q = query.trim().toLowerCase()
  return agents.filter((a) => {
    if (!agentBusy(a.status)) return false
    if (!q) return true
    const name = String(a.display_name || '').toLowerCase()
    const id = String(a.agent_id || '').toLowerCase()
    return name.includes(q) || id.includes(q)
  })
}

/** payload.task_unread 是否为真 */
export function agentTaskUnread(payload: Record<string, unknown> | undefined): boolean {
  const v = payload?.task_unread
  return v === true || v === 1 || v === '1'
}

/** 任务完成未读列表（非忙碌；供系统分类「未读」） */
export function listUnreadAgents(
  agents: import('../api').PublicMirrorAgent[],
  query = '',
): import('../api').PublicMirrorAgent[] {
  const q = query.trim().toLowerCase()
  return agents.filter((a) => {
    if (agentBusy(a.status)) return false
    if (!agentTaskUnread(a.payload)) return false
    if (!q) return true
    const name = String(a.display_name || '').toLowerCase()
    const id = String(a.agent_id || '').toLowerCase()
    return name.includes(q) || id.includes(q)
  })
}

/** Read run start unix seconds from mirror payload */
export function agentRunStartedAt(payload: Record<string, unknown> | undefined): number | null {
  const n = Number(payload?.run_started_at)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

/** Format busy elapsed time from run_started_at (unix sec) → "3分12秒" */
export function formatBusyElapsed(
  runStartedAt: number | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  if (runStartedAt == null || !Number.isFinite(runStartedAt) || runStartedAt <= 0) return ''
  let sec = Math.max(0, nowSec - Math.floor(runStartedAt))
  if (sec < 60) return `${sec}秒`
  const mins = Math.floor(sec / 60)
  sec = sec % 60
  if (mins < 60) return sec > 0 ? `${mins}分${sec}秒` : `${mins}分`
  const hours = Math.floor(mins / 60)
  const remMin = mins % 60
  return remMin > 0 ? `${hours}小时${remMin}分` : `${hours}小时`
}
