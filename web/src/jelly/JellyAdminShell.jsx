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
 * 水母模式管理台壳：窄轨 + 顶栏 + 工作区（水母）/ 治理页内容。
 * 经典界面组件原样塞进主区，不改其样式。
 */
export default function JellyAdminShell({
  authHeaders,
  onUnauthorized,
  adminMenu,
  onNavigate,
  uiMode,
  onUiModeChange,
  onHire,
  onExpandAgent,
  onLogout,
  badges = {},
  /** 展开完整对话页时强制显示经典面板 */
  forcePanel = false,
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
    // 当前组为空时，自动切到有人的工作组
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

  const showJelly = adminMenu === 'agents' && !forcePanel

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
      <div className={`jelly-main ${showJelly ? 'is-jelly' : 'is-panel'}`}>
        {showJelly && (
          <JellyWorkspace
            authHeaders={authHeaders}
            onUnauthorized={onUnauthorized}
            active
            onExpandAgent={onExpandAgent}
            teamId={teamId}
            folders={folders}
            agents={agents}
          />
        )}
        {/* 经典面板始终挂载（隐藏），避免切水母时拆掉数字人 SSE */}
        <div
          className="jelly-panel-host"
          style={showJelly ? { display: 'none' } : undefined}
          aria-hidden={showJelly}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
