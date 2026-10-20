/**
 * 把经典 UI 的 agent / task / 授权 映射为水母触手模型。
 * state: idle | working | error | waiting
 */

/** 引擎 status → 水母 state */
export function mapAgentState(agent, { hasPendingApproval = false, sessionLoading = false } = {}) {
  if (hasPendingApproval) return 'waiting'
  const s = String(agent?.status || 'idle')
  if (s === 'error') return 'error'
  if (s === 'waiting') return 'waiting'
  if (
    sessionLoading
    || s === 'running'
    || s === 'busy'
    || s === 'compressing'
    || s === 'initializing'
    || s === '插话中'
  ) {
    return 'working'
  }
  if (agent?.occupancy?.source_type === 'WORKFLOW' || Number(agent?.occupancy?.workflow_run_id) > 0) {
    return 'working'
  }
  if (agent?.occupancy?.source_type === 'CLONE_INIT') return 'working'
  return 'idle'
}

/** 一行当前任务文案（无徽章/数字优先） */
export function mapCurrentTask(agent, tasks = []) {
  const o = agent?.occupancy
  if (o) {
    const team = o.source_name || o.source_type || ''
    const task = o.task_name || ''
    const line = `${team}${task ? ` · ${task}` : ''}`.trim()
    if (line) return line
  }
  const active = (tasks || []).find((t) => {
    const st = String(t.status || '').toLowerCase()
    return st === 'running' || st === 'active' || st === 'in_progress' || st === 'working'
  }) || (tasks || [])[0]
  if (active) {
    const name = active.task_name || active.message || ''
    const prog = active.progress
    if (name && prog != null && prog !== '' && Number(prog) < 1) {
      const pct = Number(prog) <= 1 ? Math.round(Number(prog) * 100) : Math.round(Number(prog))
      return `${name} · ${pct}%`
    }
    if (name) return name
    if (active.message) return active.message
  }
  const s = String(agent?.status || 'idle')
  if (s === 'compressing') return '压缩记忆中'
  if (s === 'initializing') return '初始化中'
  if (s === 'running' || s === 'busy') return '忙碌中'
  if (s === 'error') return agent?.last_error || '出错了'
  if (s === 'waiting') return '等你看看'
  return '休息中'
}

/**
 * agents + 可选 tasksByAgent + pendingApprovals → 触手列表
 * 稳定按 id 排序，u 均匀铺在铃缘上。
 */
export function toTentacleAgents(agents, {
  tasksByAgent = {},
  pendingApprovals = [],
  loadingIds = new Set(),
} = {}) {
  const list = (agents || []).slice().sort((a, b) => Number(a.id) - Number(b.id))
  const n = Math.max(list.length, 1)
  return list.map((a, i) => {
    const id = String(a.id)
    const hasPending = (pendingApprovals || []).some((ap) => String(ap.agentId) === id)
    const tasks = tasksByAgent[a.id] || tasksByAgent[id] || []
    const state = mapAgentState(a, {
      hasPendingApproval: hasPending,
      sessionLoading: loadingIds.has(Number(a.id)) || loadingIds.has(id),
    })
    const u = list.length === 1 ? 0.5 : 0.08 + (0.84 * i) / Math.max(n - 1, 1)
    const len = state === 'idle' ? 0.38 : state === 'waiting' || state === 'error' ? 0.5 : 0.55 + (i % 3) * 0.03
    return {
      id,
      agentId: Number(a.id),
      n: a.name || `员工 #${a.id}`,
      t: mapCurrentTask(a, tasks),
      s: state === 'error' ? 'wait' : state === 'waiting' ? 'wait' : state, // canvas 用 wait
      state,
      u,
      len,
      lead: state === 'working' && i === Math.floor(list.length / 2),
      raw: a,
    }
  })
}

/** 待授权 → 水母审批卡（最多 2 个按钮） */
export function permToApproval(p) {
  if (!p) return null
  const trust = p.tool_name === 'WorkspaceTrust'
  const title = trust
    ? `需要确认是否信任工作区：${p.summary || p.tool_name || ''}`
    : (p.meaning || p.summary || p.tool_name || '申请使用工具，需要你授权')
  const actions = trust
    ? [
      { k: 'allow', l: '信任并继续', pri: 1 },
      { k: 'deny', l: '拒绝' },
    ]
    : [
      { k: 'allow', l: '本次允许', pri: 1 },
      { k: 'deny', l: '拒绝' },
    ]
  return {
    id: String(p.request_id || p.id),
    approvalId: String(p.request_id || p.id),
    agentId: String(p.agentId || p.agent_id || ''),
    title: String(title).slice(0, 160),
    actions: actions.slice(0, 2),
    source: 'permission',
    raw: p,
  }
}
