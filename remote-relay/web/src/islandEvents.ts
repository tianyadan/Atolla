import type { PublicMirrorAgent, PublicMirrorPermission } from './api'
import { resolveMirrorJellyColor } from './jelly/jellyColor'
import { agentBusy } from './utils/agentStatus'

export type IslandEventKind = 'error' | 'approval' | 'running' | 'completed'

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
  durationMs?: number
  summary?: string
  jellyColor?: string
}

export type IslandPresentation = {
  activeKind: IslandEventKind | null
  count: number
  items: IslandEvent[]
}

const PRIORITY: IslandEventKind[] = ['error', 'approval', 'running', 'completed']

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

/** Merge mirrored terminal snapshots, running agents, and live approvals. */
export function buildIslandEvents(
  instanceId: string,
  agents: PublicMirrorAgent[],
  permissions: PublicMirrorPermission[],
  nowMs: number = Date.now(),
): IslandEvent[] {
  const events: IslandEvent[] = []
  const byId = new Map(agents.map((row) => [row.agent_id, row]))

  for (const row of agents) {
    const payload = row.payload ?? {}
    const base = eventBase(instanceId, row)
    const kind = payload.task_unread_kind
    const terminalAt = timestampMs(payload.task_unread_at)
    // 只认新协议的明确类型与时间，旧 task_unread 布尔值不能凭空生成终态事件。
    if ((kind === 'completed' || kind === 'error') && terminalAt != null) {
      const summary = String(payload.task_unread_summary || '').trim()
      events.push({
        ...base,
        id: `${kind}:${row.agent_id}`,
        type: kind,
        occurredAt: terminalAt,
        durationMs: optionalPositiveInt(payload.task_unread_duration_ms),
        summary: summary || undefined,
      })
    }

    if (agentBusy(row.status)) {
      events.push({
        ...base,
        id: `running:${row.agent_id}`,
        type: 'running',
        occurredAt: timestampMs(payload.run_started_at) ?? timestampMs(row.synced_at) ?? nowMs,
        summary: String(row.status || 'running'),
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
      summary: summary || undefined,
    })
  }

  return events
}

/** Pick the highest-priority category, preserving full count and limiting native details. */
export function selectIslandPresentation(
  events: IslandEvent[],
  limit: number = 5,
): IslandPresentation {
  const activeKind = PRIORITY.find((kind) => events.some((event) => event.type === kind)) ?? null
  if (!activeKind) return { activeKind: null, count: 0, items: [] }
  const matching = events
    .filter((event) => event.type === activeKind)
    .sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
  return {
    activeKind,
    count: matching.length,
    items: matching.slice(0, Math.max(0, limit)),
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
