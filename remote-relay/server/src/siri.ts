import type { RelayDatabase } from './db.js'
import { getInstanceRow } from './auth/instance.js'
import {
  listAgentsMirror,
  listPermissionsMirror,
  listTasksMirror,
  type PublicMirrorAgent,
  type PublicMirrorTask,
} from './mirror.js'

export const SIRI_INSTANCE_ONLINE_THRESHOLD_MS = 30_000
export const SIRI_MIRROR_STALE_THRESHOLD_MS = 60_000

const WORKING_STATUSES = new Set([
  'running',
  'busy',
  'initializing',
  'compressing',
  'waiting',
  'approval',
  '插话中',
])

export type SiriAgentSummary = {
  id: string
  instance_id: string
  agent_id: string
  name: string
  disambiguation_label: string
  group_name: string
  status: string
  working: boolean
  synced_at: number
  speech_text: string
}

export type SiriAgentListOptions = {
  group?: string
  working?: boolean
}

export type SiriRuleStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'approval'
  | 'compressing'
  | 'error'
  | 'completed'

export type SiriAgentStatus = {
  id: string
  instance_id: string
  agent_id: string
  name: string
  group_name: string
  machine_status: 'online' | 'offline'
  status: SiriRuleStatus
  progress: number | null
  current_task: string | null
  synced_at: number
  stale: boolean
  source: 'rules' | 'ai'
  speech_text: string
}

export interface AgentStatusProvider {
  getStatus(
    db: RelayDatabase,
    instanceId: string,
    agentId: string,
    nowMs?: number,
  ):
    | { ok: true; status: SiriAgentStatus }
    | { ok: false; status: number; error: string }
}

/** Siri 实体使用 instanceId:agentId，避免不同实例下 ID 冲突。 */
export function siriAgentEntityId(instanceId: string, agentId: string): string {
  return `${instanceId}:${agentId}`
}

export function isSiriAgentWorking(status: string | null | undefined): boolean {
  return WORKING_STATUSES.has(String(status || 'idle').trim().toLowerCase())
}

export function deriveRuleAgentStatus(input: {
  agentStatus?: string | null
  taskStatus?: string | null
  unreadKind?: unknown
  hasPendingApproval?: boolean
}): SiriRuleStatus {
  const agent = String(input.agentStatus || '').trim().toLowerCase()
  const task = String(input.taskStatus || '').trim().toLowerCase()
  const unread = String(input.unreadKind || '').trim().toLowerCase()
  if (agent === 'error' || agent === 'failed' || task === 'error' || task === 'failed' || unread === 'error') {
    return 'error'
  }
  if (input.hasPendingApproval || agent === 'approval' || task === 'approval') return 'approval'
  if (agent === 'compressing' || task === 'compressing') return 'compressing'
  if (agent === 'waiting' || task === 'waiting' || task === 'paused') return 'waiting'
  if (isSiriAgentWorking(agent) || ['running', 'busy', 'in_progress', 'queued'].includes(task)) {
    return 'running'
  }
  if (['completed', 'done', 'success'].includes(agent)
      || ['completed', 'done', 'success'].includes(task)
      || ['completed', 'done'].includes(unread)) {
    return 'completed'
  }
  return 'idle'
}

function statusSpeech(status: string, working: boolean): string {
  if (working) {
    switch (status) {
      case 'waiting':
        return '正在等待'
      case 'approval':
        return '正在等待授权'
      case 'compressing':
        return '正在整理上下文'
      default:
        return '正在工作'
    }
  }
  if (status === 'error' || status === 'failed') return '执行出现错误'
  if (status === 'completed' || status === 'done') return '最近任务已完成'
  return '当前空闲'
}

function toSiriAgent(instanceId: string, agent: PublicMirrorAgent): SiriAgentSummary {
  const status = String(agent.status || 'idle').trim().toLowerCase() || 'idle'
  const working = isSiriAgentWorking(status)
  const name = String(agent.display_name || agent.agent_id).trim() || agent.agent_id
  const groupName = String(agent.payload.folder_name || '').trim() || '未分组'
  return {
    id: siriAgentEntityId(instanceId, agent.agent_id),
    instance_id: instanceId,
    agent_id: agent.agent_id,
    name,
    disambiguation_label: name,
    group_name: groupName,
    status,
    working,
    synced_at: agent.synced_at,
    speech_text: `${groupName}的${name}${statusSpeech(status, working)}。`,
  }
}

/** 读取 Siri 数字人列表，可按工作组和工作状态过滤。 */
export function listSiriAgents(
  db: RelayDatabase,
  instanceId: string,
  options: SiriAgentListOptions = {},
):
  | { ok: true; agents: SiriAgentSummary[] }
  | { ok: false; status: number; error: string } {
  const result = listAgentsMirror(db, instanceId)
  if (!result.ok) return result

  const group = options.group?.trim().toLocaleLowerCase('zh-CN')
  const summaries = result.agents.map((agent) => toSiriAgent(instanceId, agent))
  const agents = summaries
    .map((agent) => {
      const sameName = summaries.filter((item) => item.name === agent.name)
      if (sameName.length <= 1) return agent
      const sameGroup = sameName.filter((item) => item.group_name === agent.group_name)
      return {
        ...agent,
        disambiguation_label: sameGroup.length > 1
          ? `${agent.name}（${agent.group_name}，编号 ${agent.agent_id}）`
          : `${agent.name}（${agent.group_name}）`,
      }
    })
    .filter((agent) => {
      if (group && agent.group_name.toLocaleLowerCase('zh-CN') !== group) return false
      if (options.working != null && agent.working !== options.working) return false
      return true
    })

  return { ok: true, agents }
}

function numericProgress(task: PublicMirrorTask | undefined): number | null {
  if (!task) return null
  const progress = Number(task.payload.progress)
  if (!Number.isFinite(progress)) return null
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function currentTask(task: PublicMirrorTask | undefined): string | null {
  if (!task) return null
  const name = String(task.payload.task_name || task.payload.message || '').trim()
  return name || null
}

function formatSyncTime(syncedAt: number): string {
  if (!Number.isFinite(syncedAt) || syncedAt <= 0) return '未知时间'
  return new Date(syncedAt).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
}

function statusSpeechText(status: SiriRuleStatus): string {
  switch (status) {
    case 'running': return '正在执行任务'
    case 'waiting': return '正在等待继续'
    case 'approval': return '正在等待你的授权'
    case 'compressing': return '正在整理上下文'
    case 'error': return '执行遇到了错误'
    case 'completed': return '最近任务已经完成'
    default: return '当前空闲'
  }
}

/** 首期规则状态提供器；未来 AI 提供器只需实现同一接口。 */
export class RuleAgentStatusProvider implements AgentStatusProvider {
  getStatus(
    db: RelayDatabase,
    instanceId: string,
    agentId: string,
    nowMs: number = Date.now(),
  ):
    | { ok: true; status: SiriAgentStatus }
    | { ok: false; status: number; error: string } {
    const instance = getInstanceRow(db, instanceId)
    if (!instance) return { ok: false, status: 404, error: 'Instance not found' }
    const agentsResult = listAgentsMirror(db, instanceId)
    if (!agentsResult.ok) return agentsResult
    const agent = agentsResult.agents.find((item) => item.agent_id === agentId)
    if (!agent) return { ok: false, status: 404, error: 'Agent not found' }

    const tasksResult = listTasksMirror(db, instanceId, agentId)
    if (!tasksResult.ok) return tasksResult
    const task = tasksResult.tasks[0]
    const permissionsResult = listPermissionsMirror(db, instanceId, agentId, nowMs)
    const hasPendingApproval = permissionsResult.ok && permissionsResult.items.length > 0
    const status = deriveRuleAgentStatus({
      agentStatus: agent.status,
      taskStatus: task?.status,
      unreadKind: agent.payload.task_unread_kind,
      hasPendingApproval,
    })
    const lastHeartbeatAt = instance.last_heartbeat_at ?? 0
    const machineStatus = lastHeartbeatAt > 0 && nowMs - lastHeartbeatAt < SIRI_INSTANCE_ONLINE_THRESHOLD_MS
      ? 'online'
      : 'offline'
    const syncedAt = Math.max(agent.synced_at, task?.synced_at ?? 0)
    const stale = machineStatus === 'offline'
      || syncedAt <= 0
      || nowMs - syncedAt >= SIRI_MIRROR_STALE_THRESHOLD_MS
    const name = String(agent.display_name || agent.agent_id).trim() || agent.agent_id
    const groupName = String(agent.payload.folder_name || '').trim() || '未分组'
    const progress = numericProgress(task)
    const taskName = currentTask(task)
    const detail = [
      `${groupName}的${name}${statusSpeechText(status)}`,
      taskName ? `当前任务是${taskName}` : '',
      progress != null ? `进度百分之${progress}` : '',
    ].filter(Boolean).join('，')
    const staleText = stale
      ? `状态最后同步于${formatSyncTime(syncedAt)}，可能已经过期。`
      : ''
    const offlineText = machineStatus === 'offline' ? 'Mac 实例当前离线。' : ''

    return {
      ok: true,
      status: {
        id: siriAgentEntityId(instanceId, agentId),
        instance_id: instanceId,
        agent_id: agentId,
        name,
        group_name: groupName,
        machine_status: machineStatus,
        status,
        progress,
        current_task: taskName,
        synced_at: syncedAt,
        stale,
        source: 'rules',
        speech_text: `${offlineText}${detail}。${staleText}`,
      },
    }
  }
}

export const agentStatusProvider: AgentStatusProvider = new RuleAgentStatusProvider()
