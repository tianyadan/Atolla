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

/** 空闲 / 忙碌中 */
export function agentStatusLabel(status: string | null | undefined): string {
  return agentBusy(status) ? '忙碌中' : '空闲'
}

/** Default avatar (same strategy as PC) */
export const DEFAULT_AGENT_AVATAR =
  'https://img0.baidu.com/it/u=890210585,2769039861&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=667'

/** Resolve display avatar from mirror payload */
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
    const key = folderId > 0 ? `f:${folderId}` : 'root'
    const title = folderId > 0 ? folderName || `工作组 ${folderId}` : '未入组'
    let g = map.get(key)
    if (!g) {
      g = { key, title, sort: folderId > 0 ? folderId : 0, agents: [] }
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
