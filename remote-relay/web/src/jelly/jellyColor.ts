/** 像素水母颜色：与 PC / 后端 jelly_color 对齐 */

export const JELLY_COLORS = [
  'orange',
  'yellow',
  'blue',
  'green',
  'purple',
  'red',
  'cyan',
  'teal',
  'pink',
  'lime',
  'coral',
  'sky',
] as const

export type JellyColor = (typeof JELLY_COLORS)[number]

export const JELLY_COLOR_FIELD = 'jelly_color'

/** 是否合法颜色名 */
export function isJellyColor(value: unknown): value is JellyColor {
  return JELLY_COLORS.includes(String(value || '').trim().toLowerCase() as JellyColor)
}

/** 规范化颜色名；非法则返回空串 */
export function normalizeJellyColor(value: unknown): JellyColor | '' {
  const c = String(value || '').trim().toLowerCase()
  return isJellyColor(c) ? c : ''
}

/**
 * 与后端 AssignJellyColor 一致：数值 id 用 id % 12；
 * 非数值 id 用稳定哈希再 mod 12。
 * 顺序：0=orange … 5=red, 6=cyan, 7=teal, 8=pink, 9=lime, 10=coral, 11=sky
 */
export function assignJellyColor(id: string | number | null | undefined): JellyColor {
  const n = Number(id)
  if (Number.isFinite(n) && Number.isInteger(n)) {
    const idx = ((n % 12) + 12) % 12
    return JELLY_COLORS[idx]
  }
  const s = String(id ?? '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return JELLY_COLORS[Math.abs(h) % 12]
}

/** 从员工 / mirror payload 解析展示色 */
export function resolveJellyColor(agent: Record<string, unknown> | null | undefined): JellyColor {
  if (!agent || typeof agent !== 'object') return assignJellyColor('')
  const fromApi = normalizeJellyColor(agent[JELLY_COLOR_FIELD])
  if (fromApi) return fromApi
  const legacy = normalizeJellyColor(agent.jellyColor)
  if (legacy) return legacy
  if (agent.id != null && agent.id !== '') return assignJellyColor(agent.id as string | number)
  if (agent.agent_id != null && agent.agent_id !== '') {
    return assignJellyColor(agent.agent_id as string | number)
  }
  return assignJellyColor(String(agent.name || agent.display_name || ''))
}

/** 从 mirror agent 行解析颜色（payload + agent_id） */
export function resolveMirrorJellyColor(
  agent: { agent_id?: string; payload?: Record<string, unknown> } | null | undefined,
): JellyColor {
  const payload = agent?.payload || {}
  return resolveJellyColor({
    ...payload,
    agent_id: agent?.agent_id,
    id: payload.id ?? agent?.agent_id,
  })
}

/** 头像运行态：与 jellySprite 的完整精灵动作（10 个）一一对应。 */
export type JellyAvatarState = 'idle' | 'working' | 'typing' | 'waiting' | 'error' | 'ponder' | 'coding' | 'sleep' | 'eat' | 'celebrate'

/** 把统一 agent_phase 映射为 JellyAvatar state；未知阶段保留调用方回退状态。 */
export function jellyStateFromPhase(
  phase: unknown,
  fallback: JellyAvatarState = 'working',
): JellyAvatarState {
  switch (String(phase || '').toLowerCase()) {
    case 'thinking':
      return 'ponder'
    // Agent 调用工具、生成回复及一般工作阶段统一展示敲电脑动画。
    case 'tool_call':
    case 'responding':
    case 'working':
      return 'coding'
    case 'interaction_query':
    case 'waiting':
      return 'waiting'
    case 'error':
      return 'error'
    case 'idle':
      return 'idle'
    default:
      return fallback
  }
}

/** 把 agent 状态映射为 JellyAvatar state */
export function jellyStateFromAgent(
  agent:
    | {
        status?: string | null
        agent_phase?: unknown
        payload?: Record<string, unknown> | null
      }
    | null
    | undefined,
  opts: { loading?: boolean; streaming?: boolean } = {},
): JellyAvatarState {
  const st = String(agent?.status || 'idle').toLowerCase()
  if (st === 'error') return 'error'
  if (st === 'waiting') return 'waiting'
  const phase = agent?.payload?.agent_phase ?? agent?.agent_phase
  if (phase && String(phase).toLowerCase() !== 'idle') {
    return jellyStateFromPhase(phase, 'working')
  }
  if (opts.streaming) return 'typing'
  if (
    opts.loading ||
    st === 'running' ||
    st === 'busy' ||
    st === 'compressing' ||
    st === 'initializing' ||
    st === '插话中'
  ) {
    return 'working'
  }
  if (phase) return jellyStateFromPhase(phase, 'idle')
  return 'idle'
}
