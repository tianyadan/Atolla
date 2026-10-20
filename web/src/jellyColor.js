/** 像素水母头像颜色：读写集中在此，与后端 jelly_color 对齐 */

export const JELLY_COLORS = ['orange', 'yellow', 'blue', 'green', 'purple', 'red']

/** API 字段名（snake_case，与后端一致） */
export const JELLY_COLOR_FIELD = 'jelly_color'

/** 是否合法颜色名 */
export function isJellyColor(value) {
  return JELLY_COLORS.includes(String(value || '').trim().toLowerCase())
}

/** 规范化颜色名；非法则返回空串 */
export function normalizeJellyColor(value) {
  const c = String(value || '').trim().toLowerCase()
  return isJellyColor(c) ? c : ''
}

/**
 * 与后端 AssignJellyColor 一致：数值 id 用 id % 6；
 * 非数值 id 用稳定哈希再 mod 6。
 * 顺序：0=orange, 1=yellow, 2=blue, 3=green, 4=purple, 5=red
 * @param {string|number|null|undefined} id
 */
export function assignJellyColor(id) {
  const n = Number(id)
  if (Number.isFinite(n) && Number.isInteger(n)) {
    // JS 对负数 % 可能为负；与后端正 id 一致时取非负余数
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

/**
 * 从员工对象解析展示色。
 * 优先级：API jelly_color → id%6（或非数值哈希）回退。
 * 接口缺字段时不报错。
 */
export function resolveJellyColor(agent) {
  if (!agent || typeof agent !== 'object') return assignJellyColor('')
  const fromApi = normalizeJellyColor(agent[JELLY_COLOR_FIELD])
  if (fromApi) return fromApi
  // 兼容旧 camelCase（若本地预览或过渡数据仍携带）
  const legacy = normalizeJellyColor(agent.jellyColor)
  if (legacy) return legacy
  if (agent.id != null && agent.id !== '') return assignJellyColor(agent.id)
  return assignJellyColor(agent.name || '')
}

/**
 * 构造创建/更新/复制请求体中的颜色字段；非法色返回空对象。
 * @param {string} color
 */
export function jellyColorPayload(color) {
  const c = normalizeJellyColor(color)
  if (!c) return {}
  return { [JELLY_COLOR_FIELD]: c }
}

/**
 * 把 agent 状态映射为 JellyAvatar state。
 * @param {{ status?: string }|null|undefined} agent
 * @param {{ loading?: boolean, streaming?: boolean }} [opts]
 * @returns {'idle'|'working'|'typing'|'waiting'|'error'}
 */
export function jellyStateFromAgent(agent, opts = {}) {
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
