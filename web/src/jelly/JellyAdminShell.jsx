import { useCallback, useEffect, useMemo, useState } from 'react'
import { hasBearerToken, shouldForceLogout } from '../authRequest.js'
import JellyRail from './JellyRail.jsx'
import JellyTopBar from './JellyTopBar.jsx'
import JellyWorkspace from './JellyWorkspace.jsx'
import { UI_MODE_JELLY } from './uiMode.js'
import './jelly.css'

const API = '/api'
const TEAM_KEY = 'atolla_jelly_team_id'

/**
 * 水母工作组壳：窄轨 + 顶栏 + Canvas。
 * 治理页不走此壳（由 App 经典布局渲染，保证两端一致）。
 * children 用于保活经典数字人面板（隐藏挂载）。
 */
export default function JellyAdminShell({
  authHeaders,
  onUnauthorized,
  adminMenu = 'agents',
  onNavigate,
  uiMode,
  onUiModeChange,
  onHire,
  onExpandAgent,
  onLogout,
  badges = {},
  children,
}) {
  const [folders, setFolders] = useState([])
  const [agents, setAgents] = useState([])
  const [teamId, setTeamId] = useState(() => {
    try { return localStorage.getItem(TEAM_KEY) || '' } catch { return '' }
  })

  const loadMeta = useCallback(async () => {
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
    if (res.ok) {
      const d = await res.json()
      setAgents(d.items || [])
    }
    if (folderRes.ok) {
      const fd = await folderRes.json()
      setFolders(fd.items || [])
    }
  }, [authHeaders, onUnauthorized])

  useEffect(() => {
    loadMeta()
    const t = setInterval(loadMeta, 8000)
    return () => clearInterval(t)
  }, [loadMeta])

  const teams = useMemo(() => {
    const list = (folders || []).map((f) => ({ id: String(f.id), name: f.name || `工作组 #${f.id}` }))
    list.push({ id: '0', name: '未入组' })
    return list
  }, [folders])

  useEffect(() => {
    if (!teams.length) return
    const countIn = (tid) => {
      if (String(tid) === '0') return agents.filter((a) => !Number(a.folder_id)).length
      return agents.filter((a) => String(a.folder_id) === String(tid)).length
    }
    const currentOk = teamId && teams.some((t) => t.id === String(teamId)) && countIn(teamId) > 0
    if (currentOk) return
    const withPeople = teams.find((t) => countIn(t.id) > 0)
    const next = withPeople?.id || (teamId && teams.some((t) => t.id === String(teamId)) ? String(teamId) : teams[0].id)
    if (String(next) !== String(teamId)) setTeamId(next)
  }, [teams, agents, teamId])

  function changeTeam(id) {
    const next = String(id)
    setTeamId(next)
    try { localStorage.setItem(TEAM_KEY, next) } catch { /* ignore */ }
  }

  function handleMenu(id) {
    if (id === 'logout') {
      onLogout?.()
      return
    }
    onNavigate?.(id)
  }

  return (
    <div className="jelly-app">
      <JellyRail activeId={adminMenu} onNavigate={onNavigate} badges={badges} />
      <JellyTopBar
        teams={teams}
        teamId={teamId}
        onTeamChange={changeTeam}
        onHire={onHire}
        onMenu={handleMenu}
        uiMode={uiMode || UI_MODE_JELLY}
        onUiModeChange={onUiModeChange}
      />
      <div className="jelly-main is-jelly">
        <JellyWorkspace
          authHeaders={authHeaders}
          onUnauthorized={onUnauthorized}
          active
          onExpandAgent={onExpandAgent}
          teamId={teamId}
          folders={folders}
          agents={agents}
        />
        {/* 隐藏挂载经典面板，避免切壳时中断 SSE */}
        <div className="jelly-panel-host" style={{ display: 'none' }} aria-hidden>
          {children}
        </div>
      </div>
    </div>
  )
}
