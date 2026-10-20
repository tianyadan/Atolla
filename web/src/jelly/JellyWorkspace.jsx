import { useCallback, useEffect, useMemo, useState } from 'react'
import { allPendingPerms, getAgentSession, patchAgentSession, subscribeAgentSessions } from '../managedAgentSessions.js'
import { hasBearerToken, shouldForceLogout } from '../authRequest.js'
import JellyCanvas from './JellyCanvas.jsx'
import JellyDrawer from './JellyDrawer.jsx'
import JellyApprovalCards from './JellyApprovalCards.jsx'
import { useTeamStream } from './useTeamStream.js'
import { permToApproval, toTentacleAgents } from './mapAgents.js'

const API = '/api'
const TEAM_KEY = 'atolla_jelly_team_id'

/**
 * 水母工作组主视图：触手 = 员工，铃 = 派活，抽屉 = 对话。
 */
export default function JellyWorkspace({
  authHeaders,
  onUnauthorized,
  active = true,
  onExpandAgent,
  teamId: teamIdProp,
  folders: foldersProp,
  agents: agentsProp,
}) {
  const [agents, setAgents] = useState(agentsProp || [])
  const [teamId, setTeamId] = useState(() => {
    if (teamIdProp != null) return teamIdProp
    try { return localStorage.getItem(TEAM_KEY) || '' } catch { return '' }
  })
  const [tasksByAgent, setTasksByAgent] = useState({})
  const [ask, setAsk] = useState('')
  const [drawerAgent, setDrawerAgent] = useState(null)
  const [, setSessVer] = useState(0)
  const [localApprovals, setLocalApprovals] = useState([])

  useEffect(() => subscribeAgentSessions(() => setSessVer((v) => v + 1)), [])
  useEffect(() => {
    if (agentsProp) setAgents(agentsProp)
  }, [agentsProp])
  useEffect(() => {
    if (teamIdProp != null && String(teamIdProp) !== String(teamId)) {
      setTeamId(teamIdProp)
      setDrawerAgent(null)
    }
  }, [teamIdProp]) // eslint-disable-line react-hooks/exhaustive-deps
  // foldersProp 由壳层维护；此处仅用于触发与组相关的刷新
  useEffect(() => { /* team folders refreshed upstream */ }, [foldersProp])

  const teamAgents = useMemo(() => {
    return (agents || []).filter((a) => {
      if (String(teamId) === '0') return !Number(a.folder_id)
      return String(a.folder_id) === String(teamId)
    })
  }, [agents, teamId])

  const { state: streamState, transport, pushFallbackSnapshot, applyEvent } = useTeamStream(
    teamId || '0',
    { authHeaders, enabled: active, onUnauthorized },
  )

  // 拉取 agents / folders / tasks；SSE 不可用时作 fallback
  const loadAll = useCallback(async () => {
    const headers = authHeaders()
    if (!hasBearerToken(headers)) return
    const [res, folderRes] = await Promise.all([
      fetch(`${API}/admin/agents`, { headers }),
      fetch(`${API}/admin/agent-folders`, { headers }),
    ])
    if (shouldForceLogout(res.status, headers) || shouldForceLogout(folderRes.status, headers)) {
      onUnauthorized?.()
      return
    }
    if (!res.ok) return
    const d = await res.json()
    const items = d.items || []
    setAgents(items)
    // 当前组任务
    const inTeam = items.filter((a) => {
      if (String(teamId) === '0') return !Number(a.folder_id)
      return String(a.folder_id) === String(teamId)
    })
    const taskEntries = await Promise.all(
      inTeam.slice(0, 24).map(async (a) => {
        try {
          const tr = await fetch(`${API}/admin/agents/${a.id}/tasks`, { headers })
          if (!tr.ok) return [a.id, []]
          const td = await tr.json()
          return [a.id, td.items || []]
        } catch {
          return [a.id, []]
        }
      }),
    )
    const map = Object.fromEntries(taskEntries)
    setTasksByAgent(map)

    // 待授权：按会话扫一遍
    const permApprovals = []
    await Promise.all(
      inTeam.slice(0, 24).map(async (a) => {
        const conv = a.conversation_id || getAgentSession(a.id).convId
        if (!conv) return
        try {
          const pr = await fetch(`${API}/permissions/pending?conversation_id=${conv}`)
          if (!pr.ok) return
          const pd = await pr.json()
          const itemsP = pd.items || []
          if (itemsP.length) {
            patchAgentSession(a.id, { permQueue: itemsP })
            itemsP.forEach((p) => {
              const ap = permToApproval({ ...p, agentId: a.id })
              if (ap) permApprovals.push(ap)
            })
          }
        } catch { /* ignore */ }
      }),
    )
    // 合并 session 里已有的
    for (const p of allPendingPerms()) {
      if (!inTeam.some((a) => Number(a.id) === Number(p.agentId))) continue
      const ap = permToApproval(p)
      if (ap && !permApprovals.some((x) => x.id === ap.id)) permApprovals.push(ap)
    }
    setLocalApprovals(permApprovals)

    if (transport !== 'sse') {
      const loadingIds = new Set(
        inTeam.filter((a) => getAgentSession(a.id).loading).map((a) => a.id),
      )
      const tents = toTentacleAgents(inTeam, {
        tasksByAgent: map,
        pendingApprovals: permApprovals,
        loadingIds,
      })
      pushFallbackSnapshot({ tentacles: tents, approvals: permApprovals })
    }
  }, [authHeaders, onUnauthorized, teamId, transport, pushFallbackSnapshot])

  useEffect(() => {
    if (!active) return undefined
    loadAll()
    const busy = teamAgents.some((a) => {
      const s = a.status
      return s === 'running' || s === 'compressing' || s === 'initializing' || getAgentSession(a.id).loading
    })
    const ms = transport === 'sse' ? 12000 : busy ? 2500 : 5000
    const t = setInterval(loadAll, ms)
    return () => clearInterval(t)
  }, [active, loadAll, transport, teamAgents])

  const loadingIds = useMemo(() => {
    const s = new Set()
    for (const a of teamAgents) {
      if (getAgentSession(a.id).loading) s.add(a.id)
    }
    return s
  }, [teamAgents, /* sess tick */ agents]) // eslint-disable-line react-hooks/exhaustive-deps

  // 合并 stream 覆盖到触手
  const tentacles = useMemo(() => {
    const base = toTentacleAgents(teamAgents, {
      tasksByAgent,
      pendingApprovals: localApprovals,
      loadingIds,
    })
    return base.map((t) => {
      const live = streamState.agents[String(t.id)]
      if (!live) return t
      const s = live.state === 'waiting' || live.state === 'error' ? 'wait' : live.state
      return {
        ...t,
        s,
        state: live.state,
        t: live.currentTask || t.t,
        n: live.name || t.n,
      }
    })
  }, [teamAgents, tasksByAgent, localApprovals, loadingIds, streamState.agents])

  const streamApprovals = useMemo(
    () => Object.values(streamState.approvals || {}),
    [streamState.approvals],
  )

  const approvals = useMemo(() => {
    const map = new Map()
    for (const ap of [...localApprovals, ...streamApprovals]) {
      if (ap?.id) map.set(String(ap.id), ap)
    }
    return [...map.values()]
  }, [localApprovals, streamApprovals])

  const agentsById = useMemo(() => {
    const m = {}
    tentacles.forEach((t) => { m[String(t.id)] = t })
    return m
  }, [tentacles])

  const hasAlarm = approvals.length > 0

  async function decidePermission(ap, action) {
    if (ap.source === 'permission' || ap.raw?.request_id) {
      const requestId = ap.raw?.request_id || ap.id
      const behavior = action === 'deny' || action === 'skip' ? 'deny' : (action === 'allow_session' ? 'allow_session' : 'allow')
      try {
        const res = await fetch(`${API}/permissions/decide`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ request_id: requestId, behavior }),
        })
        if (res.status === 401) onUnauthorized?.()
      } catch { /* ignore */ }
      const aid = Number(ap.agentId)
      if (aid) {
        patchAgentSession(aid, {
          permQueue: (getAgentSession(aid).permQueue || []).filter((x) => x.request_id !== requestId),
        })
      }
    }
    applyEvent({ type: 'approval.resolved', approvalId: ap.id, id: ap.id, action })
    setLocalApprovals((prev) => prev.filter((x) => x.id !== ap.id))
  }

  async function dispatchTeam() {
    const text = ask.trim()
    if (!text) return
    setAsk('')
    // 优先空闲；否则第一个
    const idle = tentacles.find((t) => t.s === 'idle') || tentacles[0]
    if (!idle) return
    const agentId = idle.agentId
    applyEvent({
      type: 'agent.status',
      agentId: String(idle.id),
      state: 'working',
      currentTask: text,
      seq: (streamState.seq || 0) + 1,
    })
    try {
      const res = await fetch(`${API}/admin/agents/${agentId}/ask`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question: text }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      // 不阻塞读完流；后台跑时列表轮询会刷新状态
      if (res.body) {
        const reader = res.body.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      }
    } catch { /* ignore */ }
    loadAll()
  }

  function openDrawerById(id) {
    const t = tentacles.find((x) => String(x.id) === String(id) || String(x.agentId) === String(id))
    if (t) setDrawerAgent(t)
  }

  return (
    <div className={`jelly-workspace ${drawerAgent ? 'drawer-open' : ''}`}>
      <JellyCanvas
        agents={tentacles}
        hasAlarm={hasAlarm}
        drawerOpen={!!drawerAgent}
        handoffs={streamState.handoffs || []}
        askValue={ask}
        onAskChange={setAsk}
        onAskSubmit={dispatchTeam}
        onSelectAgent={(a) => setDrawerAgent(a)}
        onEmptyClick={() => setDrawerAgent(null)}
      />
      <JellyApprovalCards
        approvals={approvals}
        agentsById={agentsById}
        drawerAgentId={drawerAgent?.id}
        drawerOpen={!!drawerAgent}
        onAction={decidePermission}
        onOpenAgent={openDrawerById}
      />
      <JellyDrawer
        open={!!drawerAgent}
        agent={drawerAgent}
        approvals={approvals}
        authHeaders={authHeaders}
        onUnauthorized={onUnauthorized}
        onClose={() => setDrawerAgent(null)}
        onExpand={(id) => {
          setDrawerAgent(null)
          onExpandAgent?.(id)
        }}
        onApprovalAction={decidePermission}
      />
      <div className={`jelly-hint ${drawerAgent ? 'hide' : ''}`}>
        点一根触手，和那位员工说话
        {transport === 'poll' ? ' · 轮询同步' : transport === 'sse' ? ' · 实时' : ''}
        {teamAgents.length === 0 ? ' · 当前组暂无员工' : ''}
      </div>
    </div>
  )
}

