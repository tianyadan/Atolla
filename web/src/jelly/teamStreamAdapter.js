/**
 * 团队实时事件适配器。
 * 契约：GET /api/teams/:teamId/stream
 * 事件：snapshot | agent.status | task.progress | task.handoff |
 *       approval.pending | approval.resolved | task.done
 * 每条带 seq；重连带 Last-Event-ID。
 */

/** 空快照 */
export function emptyTeamState() {
  return {
    seq: 0,
    agents: {}, // id -> { id, state, currentTask, name? }
    approvals: {}, // id -> approval
    handoffs: [], // recent {from,to,taskId}
    lastEventAt: 0,
  }
}

/** 归一化 agent 状态字 */
function normState(s) {
  const v = String(s || 'idle').toLowerCase()
  if (v === 'working' || v === 'running' || v === 'busy') return 'working'
  if (v === 'waiting' || v === 'wait') return 'waiting'
  if (v === 'error') return 'error'
  return 'idle'
}

/** 应用单条事件，返回新 state（不可变） */
export function applyTeamEvent(state, ev) {
  if (!ev || !ev.type) return state
  const seq = Number(ev.seq) || state.seq
  let next = { ...state, seq: Math.max(state.seq, seq), lastEventAt: Date.now() }

  switch (ev.type) {
    case 'snapshot': {
      const agents = {}
      for (const a of ev.agents || []) {
        const id = String(a.agentId ?? a.id)
        agents[id] = {
          id,
          state: normState(a.state || a.status),
          currentTask: a.currentTask || a.task || a.t || '',
          name: a.name || a.n || '',
        }
      }
      const approvals = {}
      for (const ap of ev.approvals || []) {
        const id = String(ap.approvalId ?? ap.id)
        approvals[id] = normalizeApproval(ap)
      }
      next = { ...next, agents, approvals, handoffs: ev.handoffs || [] }
      break
    }
    case 'agent.status': {
      const id = String(ev.agentId ?? ev.agent?.id ?? '')
      if (!id) break
      const prev = next.agents[id] || { id, state: 'idle', currentTask: '', name: '' }
      next = {
        ...next,
        agents: {
          ...next.agents,
          [id]: {
            ...prev,
            state: normState(ev.state ?? ev.agent?.state),
            currentTask: ev.currentTask ?? ev.agent?.currentTask ?? prev.currentTask,
            name: ev.name ?? ev.agent?.name ?? prev.name,
          },
        },
      }
      break
    }
    case 'task.progress': {
      const id = String(ev.agentId ?? '')
      if (!id) break
      const prev = next.agents[id] || { id, state: 'working', currentTask: '', name: '' }
      const msg = ev.message || prev.currentTask
      const prog = ev.progress
      let currentTask = msg
      if (prog != null && prog !== '' && msg) {
        const pct = Number(prog) <= 1 ? Math.round(Number(prog) * 100) : Math.round(Number(prog))
        if (!String(msg).includes(`${pct}`)) currentTask = `${msg} · ${pct}%`
      }
      next = {
        ...next,
        agents: {
          ...next.agents,
          [id]: { ...prev, state: 'working', currentTask },
        },
      }
      break
    }
    case 'task.handoff': {
      const handoffs = [...(next.handoffs || []), { from: ev.from, to: ev.to, taskId: ev.taskId }].slice(-8)
      next = { ...next, handoffs }
      break
    }
    case 'approval.pending': {
      const ap = normalizeApproval(ev)
      if (!ap.id) break
      next = { ...next, approvals: { ...next.approvals, [ap.id]: ap } }
      // 触手进入 waiting
      if (ap.agentId) {
        const prev = next.agents[ap.agentId] || { id: ap.agentId, state: 'waiting', currentTask: '', name: '' }
        next = {
          ...next,
          agents: {
            ...next.agents,
            [ap.agentId]: { ...prev, state: 'waiting', currentTask: prev.currentTask || ap.title },
          },
        }
      }
      break
    }
    case 'approval.resolved': {
      const id = String(ev.approvalId ?? ev.id ?? '')
      if (!id) break
      const { [id]: removed, ...rest } = next.approvals
      next = { ...next, approvals: rest }
      if (removed?.agentId) {
        const prev = next.agents[removed.agentId]
        if (prev) {
          next = {
            ...next,
            agents: {
              ...next.agents,
              [removed.agentId]: {
                ...prev,
                state: ev.action === 'deny' || ev.action === 'skip' ? 'idle' : 'working',
              },
            },
          }
        }
      }
      break
    }
    case 'task.done': {
      const id = String(ev.agentId ?? '')
      if (!id) break
      const prev = next.agents[id] || { id, state: 'idle', currentTask: '', name: '' }
      next = {
        ...next,
        agents: {
          ...next.agents,
          [id]: { ...prev, state: 'idle', currentTask: ev.message || '休息中' },
        },
      }
      break
    }
    default:
      break
  }
  return next
}

function normalizeApproval(ap) {
  const id = String(ap.approvalId ?? ap.id ?? '')
  const actions = (ap.actions || []).slice(0, 2).map((x, i) => ({
    k: x.k || x.id || x.action || `a${i}`,
    l: x.l || x.label || x.title || '确定',
    pri: (x.pri || x.primary || i === 0) ? 1 : 0,
  }))
  return {
    id,
    approvalId: id,
    agentId: String(ap.agentId ?? ap.agent_id ?? ''),
    title: ap.title || ap.message || '等你拍板',
    actions,
    source: ap.source || 'stream',
    raw: ap,
  }
}

/**
 * 解析 SSE 缓冲文本 → { events, rest, lastId }
 * 兼容 data: JSON 行；id: 作 Last-Event-ID。
 */
export function parseTeamSSE(buf) {
  const events = []
  let lastId = null
  const parts = String(buf || '').split('\n\n')
  const rest = parts.pop() || ''
  for (const block of parts) {
    let id = null
    let dataLines = []
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) id = line.slice(3).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (id) lastId = id
    if (!dataLines.length) continue
    try {
      const ev = JSON.parse(dataLines.join('\n'))
      if (id && ev.seq == null) ev.seq = Number(id) || 0
      events.push(ev)
    } catch { /* skip bad frame */ }
  }
  return { events, rest, lastId }
}

/**
 * 用 REST 快照拼一份 fallback 事件（供轮询）。
 * agents: 经典列表；approvals: 已映射的审批卡。
 */
export function snapshotFromClassic({ agents, tentacles, approvals, seq = 0 }) {
  return {
    type: 'snapshot',
    seq,
    agents: (tentacles || agents || []).map((a) => ({
      agentId: a.id || a.agentId,
      state: a.state || a.s || a.status || 'idle',
      currentTask: a.currentTask || a.t || '',
      name: a.name || a.n || '',
    })),
    approvals: approvals || [],
  }
}
