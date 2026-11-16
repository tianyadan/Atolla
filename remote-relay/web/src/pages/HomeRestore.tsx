import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  clearToken,
  fetchAgents,
  fetchInstances,
  hasUnlockToken,
  type PublicInstance,
  type PublicMirrorAgent,
} from '../api'
import { CreateAgentSheet } from '../components/CreateAgentSheet'
import { IconMonitor } from '../components/InstanceIcons'
import { MobileChatHeader } from '../components/MobileChatHeader'
import { PageShell } from '../components/PageShell'
import { JellyAvatar } from '../jelly/JellyAvatar'
import { jellyStateFromAgent, resolveMirrorJellyColor } from '../jelly/jellyColor'
import { agentStatusLabel } from '../utils/agentStatus'
import {
  chatRoute,
  loadInstanceChatSelection,
  loadLastChatSelection,
  rememberChatSelection,
} from '../utils/chatResume'
import { isInstanceOnline } from '../utils/instance'
import { getConnectionSession, hasLanInstanceAccess } from '../utils/connectionSession'
import { resolveRestoreInstanceId } from '../utils/restoreTarget'

type RestoreView =
  | 'loading'
  | 'choose-instance'
  | 'choose-agent'
  | 'empty-agent'
  | 'offline'
  | 'missing-instance'
  | 'error'

/** App 首页：恢复最近实例 + 数字人；失败时明确停在原目标，不静默跳到其它实例。 */
export function HomeRestorePage() {
  const { instanceId: routeInstanceId = '' } = useParams()
  const navigate = useNavigate()
  const [view, setView] = useState<RestoreView>('loading')
  const [message, setMessage] = useState('正在恢复上一次对话…')
  const [instances, setInstances] = useState<PublicInstance[]>([])
  const [agents, setAgents] = useState<PublicMirrorAgent[]>([])
  const [instanceId, setInstanceId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const restore = useCallback(async () => {
    let resolvingInstanceId = routeInstanceId
    setView('loading')
    setMessage('正在恢复上一次对话…')
    setAgents([])
    try {
      const instanceRows = await fetchInstances()
      setInstances(instanceRows)
      if (instanceRows.length === 0) {
        // 实例是数字人的前置条件，没有实例时直接进入现有实例绑定页。
        navigate('/instances?onboarding=1', { replace: true })
        return
      }

      const globalTarget = loadLastChatSelection()
      const lanSession = getConnectionSession()
      // LAN Facade deliberately exposes only the QR-bound Mac. Prefer that
      // target over a previous cloud conversation, which cannot exist in the
      // local instance list and would otherwise be misreported as removed.
      let targetInstanceId = resolveRestoreInstanceId({
        routeInstanceId,
        lanSessionInstanceId: lanSession?.instanceId,
        lastChatInstanceId: globalTarget?.instanceId,
      })
      if (!targetInstanceId) {
        if (instanceRows.length === 1) targetInstanceId = instanceRows[0].instance_id
        else {
          setView('choose-instance')
          setMessage('先选择这次要使用的实例。之后 Atolla 会记住每个实例最近使用的数字人。')
          return
        }
      }
      resolvingInstanceId = targetInstanceId

      const instance = instanceRows.find((item) => item.instance_id === targetInstanceId)
      if (!instance) {
        setView('missing-instance')
        setMessage('上次使用的实例已被移除，请重新选择实例。')
        return
      }
      setInstanceId(targetInstanceId)
      if (!isInstanceOnline(instance.last_heartbeat_at)) {
        setView('offline')
        setMessage(`${instance.display_name} 当前离线，Atolla 没有自动切换到其它实例。`)
        return
      }
      if (!hasUnlockToken(targetInstanceId) && !hasLanInstanceAccess(targetInstanceId)) {
        navigate(`/instances?unlock=${encodeURIComponent(targetInstanceId)}&resume=1`, {
          replace: true,
        })
        return
      }

      const fetchedAgents = await fetchAgents(targetInstanceId)
      const agentMap = new Map<string, PublicMirrorAgent>()
      for (const row of fetchedAgents) {
        const previous = agentMap.get(row.agent_id)
        if (!previous || row.synced_at >= previous.synced_at) agentMap.set(row.agent_id, row)
      }
      const rows = [...agentMap.values()]
      setAgents(rows)
      const instanceTarget = loadInstanceChatSelection(targetInstanceId)
      const target =
        instanceTarget ||
        (globalTarget?.instanceId === targetInstanceId ? globalTarget : null)
      const found = target ? rows.find((item) => item.agent_id === target.agentId) : null
      if (found && target) {
        navigate(chatRoute(target), { replace: true })
        return
      }
      if (rows.length === 0) {
        setView('empty-agent')
        setMessage('当前实例还没有数字人。')
        return
      }
      setView('choose-agent')
      setMessage(target ? '原数字人已不可用，请重新选择。' : '选择一个数字人开始工作。')
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 401) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      if (status === 403 && resolvingInstanceId) {
        navigate(`/instances?unlock=${encodeURIComponent(resolvingInstanceId)}&resume=1`, {
          replace: true,
        })
        return
      }
      setView('error')
      setMessage(err instanceof Error ? err.message : '恢复失败，请稍后重试。')
    }
  }, [navigate, routeInstanceId])

  useEffect(() => {
    const id = window.setTimeout(() => void restore(), 0)
    return () => window.clearTimeout(id)
  }, [restore])

  function chooseAgent(row: PublicMirrorAgent) {
    rememberChatSelection(instanceId, row.agent_id, row.payload?.conversation_id as string | number)
    navigate(chatRoute({ instanceId, agentId: row.agent_id }), { replace: true })
  }

  function chooseInstance(row: PublicInstance) {
    if (!isInstanceOnline(row.last_heartbeat_at)) return
    if (!hasUnlockToken(row.instance_id) && !hasLanInstanceAccess(row.instance_id)) {
      navigate(`/instances?unlock=${encodeURIComponent(row.instance_id)}&resume=1`, {
        replace: true,
      })
      return
    }
    navigate(`/instances/${encodeURIComponent(row.instance_id)}/start`, { replace: true })
  }

  function onCreated(agentId: string) {
    rememberChatSelection(instanceId, agentId)
    navigate(chatRoute({ instanceId, agentId }), { replace: true })
  }

  if ((view === 'choose-agent' || view === 'empty-agent') && instanceId) {
    return (
      <PageShell
        title="数字人"
        bodyClassName="page-body-chat"
        header={
          <MobileChatHeader
            key={instanceId}
            instanceId={instanceId}
            agent={null}
          />
        }
      >
        <div className="agent-start-workspace">
          {view === 'choose-agent' ? (
            <>
              <div className="agent-start-copy">
                <h1>选择数字人</h1>
                <p>{message}</p>
              </div>
              <div className="resume-agent-list" aria-label="选择数字人">
                {agents.map((row) => (
                  <button type="button" key={row.agent_id} onClick={() => chooseAgent(row)}>
                    <JellyAvatar
                      size={42}
                      color={resolveMirrorJellyColor(row)}
                      state={jellyStateFromAgent(row)}
                    />
                    <span>
                      <strong>{row.display_name || row.agent_id}</strong>
                      <small>
                        {String(row.payload?.folder_name || '').trim() || '未入组'} ·{' '}
                        {agentStatusLabel(row.status)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="agent-empty-conversation">
              <button
                type="button"
                className="agent-create-orb"
                aria-label="创建数字人"
                onClick={() => setCreateOpen(true)}
              >
                <JellyAvatar size={72} color="blue" state="idle" />
                <span aria-hidden>＋</span>
              </button>
              <h1>创建第一位数字人</h1>
              <p>数字人创建后会直接进入对话，以后打开 Atolla 将继续上次工作。</p>
              <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                创建数字人
              </button>
            </div>
          )}
        </div>
        <CreateAgentSheet
          open={createOpen}
          instanceId={instanceId}
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
        />
      </PageShell>
    )
  }

  return (
    <div className="page page-fill resume-home">
      <main className="resume-home-card">
        <img src="/app-icon-1024.png" className="resume-home-logo" alt="Atolla" />
        <h1>{view === 'loading' ? '回到工作现场' : 'Atolla'}</h1>
        <p>{message}</p>

        {view === 'choose-instance' || view === 'missing-instance' ? (
          <div className="resume-instance-list" aria-label="选择实例">
            {instances.map((row) => {
              const online = isInstanceOnline(row.last_heartbeat_at)
              return (
                <button
                  type="button"
                  key={row.instance_id}
                  disabled={!online}
                  onClick={() => chooseInstance(row)}
                >
                  <span className="resume-instance-icon"><IconMonitor size={22} /></span>
                  <span>
                    <strong>{row.display_name || row.instance_id}</strong>
                    <small>{online ? '在线' : '离线'} · {row.host?.os || '未知系统'}</small>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}

        {view !== 'loading' ? (
          <div className="resume-home-actions">
            {(view === 'offline' || view === 'error') && (
              <button type="button" className="btn primary" onClick={() => void restore()}>
                重新检查
              </button>
            )}
            <button type="button" className="btn outline" onClick={() => navigate('/instances')}>
              管理实例
            </button>
          </div>
        ) : (
          <span className="resume-loading-dot" aria-hidden />
        )}
      </main>
    </div>
  )
}
