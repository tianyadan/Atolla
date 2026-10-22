/** 像素水母颜色：与 PC / 后端 jelly_color 对齐 */

export const JELLY_COLORS = ['orange', 'yellow', 'blue', 'green', 'purple', 'red'] as const

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
 * 与后端 AssignJellyColor 一致：数值 id 用 id % 6；
 * 非数值 id 用稳定哈希再 mod 6。
 */
export function assignJellyColor(id: string | number | null | undefined): JellyColor {
  const n = Number(id)
  if (Number.isFinite(n) && Number.isInteger(n)) {
    const idx = ((n % 6) + 6) % 6
    return JELLY_COLORS[idx]
  }
  const s = String(id ?? '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return JELLY_COLORS[Math.abs(h) % 6]
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

export type JellyAvatarState = 'idle' | 'working' | 'typing' | 'waiting' | 'error'

/** 把 agent 状态映射为 JellyAvatar state */
export function jellyStateFromAgent(
  agent: { status?: string | null } | null | undefined,
  opts: { loading?: boolean; streaming?: boolean } = {},
): JellyAvatarState {
  const st = String(agent?.status || 'idle').toLowerCase()
  if (st === 'error') return 'error'
  if (st === 'waiting') return 'waiting'
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
  return 'idle'
}
