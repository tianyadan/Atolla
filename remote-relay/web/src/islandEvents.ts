import type { PublicMirrorAgent, PublicMirrorPermission } from './api'
import { resolveMirrorJellyColor } from './jelly/jellyColor'
import { agentBusy, agentTaskPlanEnabled } from './utils/agentStatus'

export type IslandEventKind = 'error' | 'approval' | 'running' | 'completed' | 'task_plan'

export type IslandTaskPlan = {
  progress: number
  phase: string
  message: string
  currentStep: number
  totalCount: number
  taskName: string
}

export type IslandEvent = {
  id: string
  type: IslandEventKind
  instanceId: string
  agentId: string
  agentName: string
  department: string
  conversationId?: number
  requestId?: string
  occurredAt: number
  /** 审批截止时间（ms）；仅 approval 有意义 */
  expiresAt?: number
  durationMs?: number
  /** 展示用工作状态：正在思考 / 正在执行 git … */
  workStatus?: string
  summary?: string
  jellyColor?: string
  /** 任务规划重点模式字段 */
  taskPlan?: IslandTaskPlan
}

export type IslandPresentation = {
  activeKind: IslandEventKind | null
  count: number
  items: IslandEvent[]
  /** list=多数字人监控；task_plan=重点展示单个任务规划进度 */
  presentation: 'list' | 'task_plan'
}

/** 上岛优先级：error > approval > task_plan > running；completed 不上岛。 */
const PRIORITY: IslandEventKind[] = ['error', 'approval', 'task_plan', 'running']

function timestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function optionalPositiveInt(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 把 PC phase / activity 转成灵动岛短文案 */
export function formatWorkStatus(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {}
  const summary = String(p.activity_summary || '').trim()
  if (summary) return summary
  const tool = String(p.activity_tool || '').trim()
  if (tool) return `正在调用 ${tool}`
  switch (String(p.agent_phase || '').toLowerCase()) {
    case 'thinking':
      return '正在思考'
    case 'working':
      return '正在工作'
    case 'responding':
      return '正在回复'
    case 'waiting':
      return '等待中'
    default:
      return ''
  }
}

const ACTIVE_PLAN_PHASES = new Set([
  'planning',
  'awaiting_confirm',
  'running',
  'paused',
])

function parseTaskPlan(payload: Record<string, unknown> | null | undefined): IslandTaskPlan | null {
  const plan = asRecord(payload?.task_plan) ?? null
  if (!plan) return null
  const phase = String(plan.phase || '').toLowerCase()
  if (phase && !ACTIVE_PLAN_PHASES.has(phase)) return null
  const progress = Math.max(0, Math.min(100, Math.round(Number(plan.progress) || 0)))
  const totalCount = Math.max(0, Math.round(Number(plan.total_count) || 0))
  const currentStep = Math.max(0, Math.round(Number(plan.current_step) || 0))
  const message = String(plan.message || '').trim()
  const taskName = String(plan.task_name || '').trim()
  // 无步骤也无进度时不当作有效规划（planning / awaiting_confirm 除外）
  if (
    totalCount <= 0 &&
    progress <= 0 &&
    !message &&
    phase !== 'planning' &&
    phase !== 'awaiting_confirm'
  ) {
    return null
  }
  const defaultMsg =
    phase === 'planning'
      ? '正在拟定计划'
      : phase === 'awaiting_confirm'
        ? '待确认'
        : phase === 'paused'
          ? '已暂停'
          : ''
  return {
    progress:
      (phase === 'planning' || phase === 'awaiting_confirm') && progress < 2 ? 2 : progress,
    phase: phase || 'running',
    message: message || defaultMsg,
    currentStep,
    totalCount,
    taskName,
  }
}

function eventBase(instanceId: string, row: PublicMirrorAgent) {
  const payload = row.payload ?? {}
  const conversationId = optionalPositiveInt(payload.conversation_id)
  return {
    instanceId,
    agentId: row.agent_id,
    agentName: String(row.display_name || row.agent_id || '数字人'),
    department: String(payload.folder_name || '').trim() || '未分组',
    conversationId: conversationId && conversationId > 0 ? conversationId : undefined,
    jellyColor: resolveMirrorJellyColor(row),
  }
}

/** Merge mirrored terminal snapshots, running agents, live approvals, and task plans. */
export function buildIslandEvents(
  instanceId: string,
  agents: PublicMirrorAgent[],
  permissions: PublicMirrorPermission[],
  nowMs: number = Date.now(),
): IslandEvent[] {
  const events: IslandEvent[] = []
  const byId = new Map(agents.map((row) => [row.agent_id, row]))

  for (const row of agents) {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    const base = eventBase(instanceId, row)
    const kind = payload.task_unread_kind
    const terminalAt = timestampMs(payload.task_unread_at)
    // 报错仍上岛；completed 本版不上岛（无 Plan 的终态不占岛）。
    if (kind === 'error' && terminalAt != null) {
      const summary = String(payload.task_unread_summary || '').trim()
      events.push({
        ...base,
        id: `error:${row.agent_id}`,
        type: 'error',
        occurredAt: terminalAt,
        durationMs: optionalPositiveInt(payload.task_unread_duration_ms),
        summary: summary || undefined,
        workStatus: summary || undefined,
      })
    }

    // 活跃任务规划优先；同 agent 有 Plan 时不再叠一层 plain running。
    let hasActivePlan = false
    if (agentTaskPlanEnabled(payload)) {
      const taskPlan = parseTaskPlan(payload)
      if (taskPlan) {
        hasActivePlan = true
        const workStatus =
          taskPlan.message ||
          formatWorkStatus(payload) ||
          String(row.status || 'running')
        const occurredAt =
          timestampMs(payload.run_started_at) ?? timestampMs(row.synced_at) ?? nowMs
        events.push({
          ...base,
          id: `task_plan:${row.agent_id}`,
          type: 'task_plan',
          occurredAt,
          workStatus,
          summary: workStatus,
          taskPlan,
        })
      }
    }

    // 普通忙碌任务也可上岛（前台 Live Activity）；有 Plan 时跳过避免重复。
    if (!hasActivePlan && agentBusy(row.status)) {
      const workStatus = formatWorkStatus(payload) || String(row.status || 'running')
      const occurredAt =
        timestampMs(payload.run_started_at) ?? timestampMs(row.synced_at) ?? nowMs
      events.push({
        ...base,
        id: `running:${row.agent_id}`,
        type: 'running',
        occurredAt,
        workStatus,
        summary: workStatus,
      })
    }
  }

  for (const permission of permissions) {
    const row = byId.get(permission.agent_id)
    if (!row) continue
    const deadline = timestampMs(permission.deadline)
    if (deadline != null && deadline <= nowMs) continue
    const summary = String(permission.summary || permission.meaning || permission.tool_name || '').trim()
    events.push({
      ...eventBase(instanceId, row),
      id: `approval:${permission.request_id}`,
      type: 'approval',
      requestId: permission.request_id,
      conversationId: permission.conversation_id > 0 ? permission.conversation_id : undefined,
      occurredAt: timestampMs(permission.created_at) ?? timestampMs(permission.synced_at) ?? nowMs,
      expiresAt: deadline ?? undefined,
      summary: summary || undefined,
      workStatus: summary || '待授权',
    })
  }

  return events
}

/** Pick the highest-priority category；task_plan 用重点进度模式。 */
export function selectIslandPresentation(
  events: IslandEvent[],
  limit: number = 5,
): IslandPresentation {
  const activeKind = PRIORITY.find((kind) => events.some((event) => event.type === kind)) ?? null
  if (!activeKind) return { activeKind: null, count: 0, items: [], presentation: 'list' }

  const matching = events
    .filter((event) => event.type === activeKind)
    .sort((a, b) => {
      if (activeKind === 'approval') {
        const ae = a.expiresAt ?? Number.POSITIVE_INFINITY
        const be = b.expiresAt ?? Number.POSITIVE_INFINITY
        if (ae !== be) return ae - be
      }
      if (activeKind === 'task_plan') {
        // 待确认优先于执行中，便于用户处理闸门
        const phaseRank = (p?: string) => {
          switch (p) {
            case 'awaiting_confirm':
              return 3
            case 'paused':
              return 2
            case 'running':
              return 1
            default:
              return 0
          }
        }
        const pr = phaseRank(a.taskPlan?.phase) - phaseRank(b.taskPlan?.phase)
        if (pr !== 0) return -pr
        const ap = a.taskPlan?.progress ?? 0
        const bp = b.taskPlan?.progress ?? 0
        if (ap !== bp) return bp - ap
      }
      return b.occurredAt - a.occurredAt || a.id.localeCompare(b.id)
    })

  const presentation: IslandPresentation['presentation'] =
    activeKind === 'task_plan' ? 'task_plan' : 'list'

  // Plan 重点只展一个；审批列表最多 limit 条
  const itemLimit = presentation === 'task_plan' ? 1 : Math.max(0, limit)
  return {
    activeKind,
    count: matching.length,
    items: matching.slice(0, itemLimit),
    presentation,
  }
}

export function islandEventDeepLink(event: IslandEvent): string {
  const instanceId = encodeURIComponent(event.instanceId)
  const agentId = encodeURIComponent(event.agentId)
  if (event.type === 'approval' && event.requestId) {
    return `atolla://approval/${instanceId}/${agentId}/${encodeURIComponent(event.requestId)}`
  }
  return `atolla://agent/${instanceId}/${agentId}/chat`
}

/** 「还有 N 项」→ 数字人列表 */
export function islandAgentsListDeepLink(instanceId: string): string {
  return `atolla://agents/${encodeURIComponent(instanceId)}`
}
