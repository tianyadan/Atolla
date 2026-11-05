import { useEffect, useMemo, useRef, useState } from 'react'
import { hasBearerToken, shouldForceLogout } from './authRequest.js'
import { ListCollapseIcon } from './adminMenuIcons.jsx'
import AgentMarkdown, { selectionInside } from './agentMarkdown.jsx'
import JellyAvatar from './JellyAvatar.jsx'
import JellyColorPicker from './JellyColorPicker.jsx'
import {
  assignJellyColor,
  jellyColorPayload,
  jellyStateFromAgent,
  jellyStateFromPhase,
  resolveJellyColor,
} from './jellyColor.js'
import {
  allPendingPerms,
  anyAgentLoading,
  clearAgentSession,
  getAgentSession,
  patchAgentSession,
  setAgentChatLog,
  subscribeAgentSessions,
} from './managedAgentSessions.js'
import { coalesceChatLog, shouldAppendAssistantChunk, stripRepeatedAssistantTail } from './coalesceChatLog.js'
import AgentSkillsPanel from './AgentSkillsPanel.jsx'
import TalentMarket from './TalentMarket.jsx'
import DismissAgentModal from './DismissAgentModal.jsx'
import {
  MAX_CHAT_IMAGES,
  appendPendingImages,
  ensureUploadedAttachments,
  imageFilesFromDataTransfer,
  revokePendingImages,
} from './chatImages.js'
import { ChatAttachPreview, ChatLightbox, ChatMessageImages } from './ChatImageUI.jsx'
import { MobileViewerIcon } from './MobileViewerIcon.jsx'
import GroupChatOfferSheet, { buildGroupMemberSet } from './GroupChatOfferSheet.jsx'
import { ModernIcon } from './modernWorkspaceIcons.jsx'
import EngineUsageChip from './EngineUsageChip.jsx'
import { runningElapsedSec } from './taskTiming.js'
import { useLocale } from './i18n/useLocale.js'
import TaskQueueRail from './TaskQueueRail.jsx'
import TaskQueueChoiceSheet from './TaskQueueChoiceSheet.jsx'
import AgentRuntimeDetail from './AgentRuntimeDetail.jsx'
import {
  beginAgentRuntime,
  finishAgentRuntime,
  recordRuntimeLLMTrace,
  recordRuntimeTool,
  recordRuntimeUsage,
  runtimeFromActiveAgent,
  runtimeFromAudit,
  selectRuntimeDetail,
} from './agentRuntime.js'

const API = '/api'
const PAGE_SIZE = 20
const ENGINES = [
  { id: 'claude', label: 'Claude', color: '#D97757' },
  { id: 'codex', label: 'Codex', color: '#10a37f' },
  { id: 'agent', label: 'Cursor', color: '#6366f1' },
]

/** 引擎错误展示压成约 1～2 行，完整内容放 title。 */
function shortErrorText(raw, max = 140) {
  let t = String(raw || '').trim()
  if (!t) return ''
  const low = t.toLowerCase()
  if (low.includes('reading additional input from stdin')) {
    return 'CLI 异常：等待 stdin 输入失败，请重试'
  }
  t = t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' · ')
  t = t.replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/** 未入组：没有工作组，或工作组已被删除（否则人和组对不上，列表两边都看不到）。 */
function isUngroupedAgent(agent, folders) {
  const id = Number(agent?.folder_id) || 0
  if (id <= 0) return true
  return !(folders || []).some((f) => Number(f.id) === id)
}

/** 运行中轮换文案（参考 Claude thinking，夹杂一点幽默） */
const THINKING_PHRASES = [
  'thinking',
  'pondering',
  'brewing ideas',
  'consulting the rubber duck',
  'untangling spaghetti',
  'asking the void politely',
  'compiling vibes',
  'negotiating with reality',
  'warming up neurons',
  'reading tea leaves',
  'sharpening virtual pencils',
  'counting token sheep',
  'channeling inner Claude',
  'politely poking the model',
  'assembling coherent thoughts',
]

const SCHEDULE_PRESETS = [
  { id: '', label: '自定义 cron', cron: '' },
  { id: 'daily9', label: '每天 09:00', cron: '0 9 * * *' },
  { id: 'daily18', label: '每天 18:00', cron: '0 18 * * *' },
  { id: 'weekday9', label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { id: 'weekly1', label: '每周一 09:00', cron: '0 9 * * 1' },
  { id: 'monthly1', label: '每月 1 日 09:00', cron: '0 9 1 * *' },
  { id: 'hourly', label: '每小时整点', cron: '0 * * * *' },
]

function engineMeta(id) {
  return ENGINES.find((e) => e.id === id) || { id, label: id, color: '#94a3b8' }
}

const BUILTIN_SKILL_ICON = {
  database: '/skill-icons/database.svg',
  server: '/skill-icons/server.svg',
  browser: '/skill-icons/browser.svg',
}

/** 引擎标签旁：已安装技能数量（浅紫粉半透明） */
function SkillCountBadge({ count }) {
  const n = Number(count) || 0
  if (n <= 0) return null
  return (
    <span className="skill-count-badge" title={`已安装 ${n} 个技能`}>
      {n}
    </span>
  )
}

/** 引擎标签 + 技能数量角标 */
function EngineTagWithSkills({ engine, skillCount }) {
  return (
    <span className="engine-tag-wrap">
      <span className="tag engine-tag" style={{ '--eng': engineMeta(engine).color }}>
        {engineMeta(engine).label}
      </span>
      <SkillCountBadge count={skillCount} />
    </span>
  )
}

/** 悬停展示已安装技能 10×10 图标 */
function SkillIconStrip({ icons }) {
  if (!icons?.length) return null
  return (
    <div className="ma-item-skills" aria-hidden="true">
      {icons.map((sk) => {
        const src = sk.icon_url || BUILTIN_SKILL_ICON[sk.icon_key]
        if (src) {
          return <img key={sk.id} className="ma-skill-ico" src={src} alt="" title={sk.name || sk.id} />
        }
        return (
          <span key={sk.id} className="ma-skill-ico glyph" title={sk.name || sk.id}>
            ◇
          </span>
        )
      })}
    </div>
  )
}

function emptyPolicy() {
  return {
    allow_write: true,
    allow_network: true,
    allow_rm: false,
    workspace_bound: false,
    workspace_path: '',
    schedule_enabled: false,
    schedule_cron: '',
    schedule_label: '',
    schedule_preset: '',
  }
}

/** 状态码 → 本地化展示文案 */
function statusZh(st, t) {
  const s = String(st || 'idle')
  if (s === 'initializing') return t('status.initializing')
  if (s === 'compressing') return t('status.compressing')
  if (s === 'running' || s === 'busy' || s === '插话中') return t('status.busy')
  if (s === 'waiting') return t('status.waiting')
  if (s === 'error') return t('status.error')
  if (s === 'done') return t('status.idle')
  return t('status.idle')
}

/** 是否被项目协作占用 */
function isWorkflowBusy(a) {
  const o = a?.occupancy
  if (!o) return false
  return o.source_type === 'WORKFLOW' || Number(o.workflow_run_id) > 0
}

/** 源员工正在为副本做静默总结：禁止提问 */
function isCloneInitBusy(a) {
  return a?.occupancy?.source_type === 'CLONE_INIT'
}

/** 对话输入应锁定 */
function isChatLocked(a) {
  return isWorkflowBusy(a) || isCloneInitBusy(a)
}

/** 忙碌来源一行文案 */
function occupancyLine(a) {
  const o = a?.occupancy
  if (!o) return ''
  const team = o.source_name || o.source_type || ''
  const task = o.task_name || ''
  return `${team}${task ? ` · ${task}` : ''}`
}

function statusClass(st) {
  const s = String(st || 'idle')
  if (s === 'initializing') return 'initializing'
  if (s === 'compressing') return 'compressing'
  if (s === 'running' || s === 'busy' || s === '插话中') return 'running'
  if (s === 'waiting') return 'waiting'
  if (s === 'error') return 'error'
  return 'idle'
}

/**
 * 管理台「数字人 · 对话」：授权弹窗、自动审核、分页、插话、设置。
 */
export default function ManagedAgentsPanel({
  authHeaders, onUnauthorized, active = true, onOpenWorkflowRun, onOpenGroupChat,
  focusAgentId = 0, onFocusConsumed, focusApprovalRequestId = '', onApprovalFocusConsumed,
  openHire = false, onHireConsumed, openSettings = false,
  presentation = 'classic', conversationRefreshKey = 0, onAgentHired,
}) {
  const { t } = useLocale()
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(0)
  /** 忙碌发送二选一弹层：{ question, attachments, hideEnqueue } */
  const [tqChoice, setTqChoice] = useState(null)
  const [tqChoiceBusy, setTqChoiceBusy] = useState(false)
  const [tqRefreshKey, setTqRefreshKey] = useState(0)
  const [taskQueueOpen, setTaskQueueOpen] = useState(false)
  const [taskQueueBadge, setTaskQueueBadge] = useState(0)
  const [runtimeDetailOpen, setRuntimeDetailOpen] = useState(false)
  const pendingQueueNextRef = useRef(null)
  const [question, setQuestion] = useState('')
  const [tasks, setTasks] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [talentMarketOpen, setTalentMarketOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyName, setCopyName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('basic') // basic | approval | skills | legacy
  const [detailMoreOpen, setDetailMoreOpen] = useState(false)
  const [skillsSubTab, setSkillsSubTab] = useState('installed') // installed | store
  const [dismissTarget, setDismissTarget] = useState(null) // agent | null
  const [legacyMounts, setLegacyMounts] = useState([])
  const [folders, setFolders] = useState([])
  const [agentSearch, setAgentSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState({})
  const [folderCreateOpen, setFolderCreateOpen] = useState(false)
  const [folderCreateName, setFolderCreateName] = useState('新建工作组')
  const [folderEdit, setFolderEdit] = useState(null) // { id, name }
  const [listCollapsed, setListCollapsed] = useState(() => {
    try { return localStorage.getItem('ma_list_collapsed') === '1' } catch { return false }
  })
  const [folderEditName, setFolderEditName] = useState('')
  const [newName, setNewName] = useState('新同事')
  const [newEngine, setNewEngine] = useState('claude')
  const [newContextWindow, setNewContextWindow] = useState(1000000)
  const [contextWindowDraft, setContextWindowDraft] = useState(1000000)
  const [newRules, setNewRules] = useState('')
  const [newJellyColor, setNewJellyColor] = useState(() => assignJellyColor('new'))
  const [jellyColorDraft, setJellyColorDraft] = useState('blue')
  const [copyJellyColor, setCopyJellyColor] = useState('blue')
  const [createErr, setCreateErr] = useState('')
  const [newPolicy, setNewPolicy] = useState(() => emptyPolicy())
  const [policyDraft, setPolicyDraft] = useState(() => emptyPolicy())
  const [workspaces, setWorkspaces] = useState([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIdx, setMentionIdx] = useState(0)
  /** @ 3～5 人时的「生成群聊」岔路；null=未弹出 */
  const [groupOffer, setGroupOffer] = useState(null) // { memberIds, question, attachments }
  const [groupCreating, setGroupCreating] = useState(false)
  const [pendingImages, setPendingImages] = useState([])
  const [lightboxSrc, setLightboxSrc] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const composerRef = useRef(null)
  const composerDropRef = useRef(null)
  const composerFileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [rulesDraft, setRulesDraft] = useState('')
  const [permBusy, setPermBusy] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [approveAllSaving, setApproveAllSaving] = useState(false)
  /** JEV 胶囊开启且健康：自动审核前置 */
  const [jevReady, setJevReady] = useState(false)
  const [jevHint, setJevHint] = useState('')
  const [taskPlanSaving, setTaskPlanSaving] = useState(false)
  const [, setTick] = useState(0)
  const [sessVer, setSessVer] = useState(0)
  const boxRef = useRef(null)
  /** 列表请求序号：慢返回的旧轮询不能盖掉刚创建出来的员工。 */
  const agentsLoadGen = useRef(0)
  /** loadDetail 世代号：切换数字人后丢弃过期拉取，避免写错会话 */
  const detailLoadGen = useRef(0)
  const stickBottomRef = useRef(true)
  /** 程序性滚底期间忽略 onScroll，避免把 stickBottom 误判为 false */
  const pinningScrollRef = useRef(false)
  const viewRef = useRef({ active, selectedId, agents })
  viewRef.current = { active, selectedId: selectedId, agents }

  const selected = agents.find((a) => a.id === selectedId) || null
  const initializing = selected?.status === 'initializing'
  // sessVer：外部 session patch 必须驱动重渲染，否则 permQueue 更新不刷新审批卡
  void sessVer
  const sess = getAgentSession(selectedId)
  const loading = !!sess.loading
  const compressing = !!sess.compressing
  const chatLog = useMemo(() => sess.chatLog || [], [sess.chatLog, sessVer])
  const interrupting = !!sess.interrupting
  const permQueue = sess.permQueue || []
  const autoOn = !!sess.autoOn
  const approveAllOn = !!selected?.auto_approve_all
  // 缺省 true：兼容尚未返回字段的旧响应
  const taskPlanOn = selected ? selected.task_plan_enabled !== false : true
  const invokeMap = sess.invokes || {}
  const localRuntimeStreamActive = loading && !!sess.abort
  const runtimeForDetail = selectRuntimeDetail(sess.runtimeDetail, sess.lastRuntimeDetail, localRuntimeStreamActive)
  const mentionCandidates = agents.filter((a) => a.id !== selectedId)

  useEffect(() => subscribeAgentSessions(() => setSessVer((v) => v + 1)), [])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 当前页面实时数据优先；刷新或外部任务结束后，用审计表恢复最近一轮。
  useEffect(() => {
    if (!selectedId || !active) return undefined
    // 当前 fetch SSE 会直接更新 runtimeDetail；此时读取数据库 processing 快照会覆盖实时轨迹。
    if (getAgentSession(selectedId).loading && getAgentSession(selectedId).abort) return undefined
    void loadLatestRuntime(selectedId)
    const serverRunning = ['running', 'busy', 'waiting', '插话中'].includes(selected?.status)
    if (!serverRunning || loading) return undefined
    const timer = window.setInterval(() => void loadLatestRuntime(selectedId), 3000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, active, selected?.status, loading])

  // 上下文圆环：空闲/运行中每 5s 刷新真实占用
  useEffect(() => {
    if (!selectedId || !active) return undefined
    // 对话进行中不要探测 /context：会 resume 同一 session，把本地命令插进当前回合
    const poll = () => {
      if (getAgentSession(selectedId).loading) return
      refreshAgentContext(selectedId, false)
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [selectedId, active])

  // 授权倒计时本地出队
  useEffect(() => {
    if (permQueue.length === 0) return
    const t = setInterval(() => {
      patchAgentSession(selectedId, {
        permQueue: (getAgentSession(selectedId).permQueue || []).filter((p) => remainSec(p) > 0),
      })
    }, 1000)
    return () => clearInterval(t)
  }, [selectedId, permQueue.length])

  /**
   * 从后端补齐某数字人挂起的命令审批（灵动岛深链 / 页签重入 / SSE 漏推）。
   * @returns {Promise<object[]>} 合并后的队列快照
   */
  async function pullPendingForAgent(agentId, { promoteRequestId = '' } = {}) {
    const id = Number(agentId) || 0
    if (!id) return []
    let conv = getAgentSession(id).convId
      || viewRef.current.agents.find((a) => a.id === id)?.conversation_id
      || 0
    // 会话 id 尚未进本地：用 messages 接口拿 conversation_id
    if (!conv) {
      try {
        const res = await fetch(`${API}/admin/agents/${id}/messages?limit=1`, { headers: authHeaders() })
        if (res.status === 401) { onUnauthorized?.(); return [] }
        if (res.ok) {
          const d = await res.json().catch(() => ({}))
          conv = Number(d.conversation_id) || 0
          if (conv) patchAgentSession(id, { convId: conv })
        }
      } catch { /* ignore */ }
    }
    if (!conv) return getAgentSession(id).permQueue || []
    try {
      const res = await fetch(`${API}/permissions/pending?conversation_id=${conv}`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return [] }
      if (!res.ok) return getAgentSession(id).permQueue || []
      const d = await res.json().catch(() => ({}))
      const items = d?.items || []
      let queue = dedupPerm([...(getAgentSession(id).permQueue || []), ...items])
        .filter((p) => remainSec(p) > 0)
      const want = String(promoteRequestId || '').trim()
      if (want) {
        const index = queue.findIndex((item) => item.request_id === want)
        if (index > 0) {
          queue = [queue[index], ...queue.slice(0, index), ...queue.slice(index + 1)]
        }
      }
      patchAgentSession(id, { permQueue: queue })
      return queue
    } catch {
      return getAgentSession(id).permQueue || []
    }
  }

  // 运行中 / 等待审批 / 灵动岛深链：轮询挂起授权（不依赖 SSE loading，避免岛跳入后弹窗丢失）
  useEffect(() => {
    if (!selectedId || !active) return undefined
    const agentId = selectedId
    const st = String(viewRef.current.agents.find((a) => a.id === agentId)?.status || '').toLowerCase()
    const waitingLike = st === 'waiting' || st === 'running' || st === 'busy' || st === '插话中'
    const needPull = loading || waitingLike || !!focusApprovalRequestId
    if (!needPull) return undefined
    let stopped = false
    const pull = () => {
      if (stopped || viewRef.current.selectedId !== agentId) return
      void pullPendingForAgent(agentId, { promoteRequestId: focusApprovalRequestId })
    }
    pull()
    const t = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedId, active, selected?.conversation_id, selected?.status, focusApprovalRequestId])

  // 窗口重新可见时补拉审批（岛点进来若未整页刷新，也能恢复弹窗）
  useEffect(() => {
    if (!active) return undefined
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const id = viewRef.current.selectedId
      if (id) void pullPendingForAgent(id, { promoteRequestId: focusApprovalRequestId })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusApprovalRequestId])

  /**
   * 刷新数字员工列表。
   * 默认保留当前选中：轮询/状态变更不得把对话窗拽到别人。
   * forceSelect + preferId：创建/复制/招聘后主动跳到新同事。
   */
  async function loadAgents(preferId, opts = {}) {
    const forceSelect = !!opts.forceSelect
    const headers = authHeaders()
    // 首页未登录也会挂着本面板轮询。没令牌时接口必然 401，不能当成登录过期。
    if (!hasBearerToken(headers)) return
    const gen = ++agentsLoadGen.current
    const [res, folderRes] = await Promise.all([
      fetch(`${API}/admin/agents`, { headers }),
      fetch(`${API}/admin/agent-folders`, { headers }),
    ])
    if (gen !== agentsLoadGen.current) return
    if (shouldForceLogout(res.status, headers) || shouldForceLogout(folderRes.status, headers)) {
      onUnauthorized?.()
      return
    }
    if (!res.ok) return
    const d = await res.json()
    if (gen !== agentsLoadGen.current) return
    let items = d.items || []
    // 正停留在某数字人对话时，终态不应进「未读」：本地立刻去掉并补一次 mark-read（防服务端竞态闪烁）
    const viewingId = viewRef.current.selectedId
    const viewing = viewingId ? items.find((a) => a.id === viewingId) : null
    if (viewing && viewing.task_unread && !isAgentBusy(viewing)) {
      items = items.map((a) => (
        a.id === viewingId
          ? {
              ...a,
              task_unread: false,
              task_unread_kind: '',
              task_unread_at: null,
              task_unread_duration_ms: 0,
              task_unread_summary: '',
            }
          : a
      ))
      fetch(`${API}/admin/agents/${viewingId}/mark-read`, {
        method: 'POST',
        headers: authHeadersRef.current(),
      }).catch(() => {})
    }
    setAgents(items)
    if (folderRes.ok) {
      const fd = await folderRes.json()
      setFolders(fd.items || [])
    }
    // 从服务端恢复自动审核开关(刷新不丢)
    items.forEach((a) => {
      if (a && a.id) patchAgentSession(a.id, { autoOn: !!a.auto_review })
    })
    // 刷新后服务端仍 running：恢复本地 loading，避免误以为已中断
    syncLoadingFromAgentStatus(items)
    setSelectedId((cur) => {
      if (forceSelect && preferId && items.some((a) => a.id === preferId)) {
        return preferId
      }
      // 用户正在看的人还在名单里：绝不因过期轮询/状态刷新改选中
      if (cur && items.some((a) => a.id === cur)) return cur
      if (preferId && items.some((a) => a.id === preferId)) return preferId
      return items[0]?.id || 0
    })
  }

  function mapMsgs(items) {
    return (items || []).map((m) => {
      let meta = null
      if (m.meta_json) {
        try { meta = typeof m.meta_json === 'string' ? JSON.parse(m.meta_json) : m.meta_json } catch { /* ignore */ }
      }
      const base = {
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        time: m.created_at ? new Date(m.created_at).getTime() : 0,
        replySec: m.reply_ms ? Math.round(m.reply_ms / 1000) : null,
        note: m.note,
        calleeId: meta?.callee_id,
        calleeName: meta?.callee_name,
        callerName: meta?.caller_name,
        attachments: Array.isArray(meta?.attachments) ? meta.attachments : [],
        collapsed: m.role === 'invoke_quote',
      }
      if (m.role === 'command' && typeof m.content === 'string' && m.content.trim().startsWith('{')) {
        try {
          const cmd = JSON.parse(m.content)
          return {
            ...base,
            content: cmd.command || m.content,
            decision: cmd.decision || (m.status === 'denied' ? 'deny' : 'allow'),
            decidedBy: cmd.by || '',
            risk: cmd.risk || '',
            meaning: cmd.meaning || '',
            note: cmd.note || m.note,
          }
        } catch { /* plain text */ }
      }
      if (m.role === 'command' && m.status === 'denied') {
        return { ...base, decision: 'deny' }
      }
      return base
    })
  }

  const authHeadersRef = useRef(authHeaders)
  authHeadersRef.current = authHeaders
  /** 告诉后端电脑是否正打开这个数字人的对话（含挂机未关页面）；仅存在感，不清未读 */
  useEffect(() => {
    const send = (agentId) => {
      fetch(`${API}/admin/agents/pc-viewer`, {
        method: 'POST',
        headers: authHeadersRef.current({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ agent_id: agentId }),
      }).catch(() => {})
    }
    if (!active || !selectedId) {
      send(0)
      return undefined
    }
    send(selectedId)
    // 终态跳过未读依赖 pc-viewer 心跳；略缩短以免任务结束时 TTL 误判已离开
    const timer = window.setInterval(() => send(selectedId), 8000)
    return () => {
      window.clearInterval(timer)
      send(0)
    }
  }, [active, selectedId])

  /** 主动点选数字人时标记已读（切换选中才触发，非心跳） */
  useEffect(() => {
    if (!active || !selectedId) return undefined
    fetch(`${API}/admin/agents/${selectedId}/mark-read`, {
      method: 'POST',
      headers: authHeadersRef.current(),
    }).catch(() => {})
  }, [active, selectedId])

  /**
   * 拉取会话详情。
   * preferDb：Ask 回合结束后以 DB 为准，丢掉 SSE 无 id 命令挂尾，避免最终回复被顶出视口。
   */
  async function loadDetail(id, { force = false, preferDb = false } = {}) {
    if (!id) {
      if (!viewRef.current.selectedId) setTasks([])
      return
    }
    const gen = ++detailLoadGen.current
    const local = getAgentSession(id)
    const msgLimit = preferDb ? 100 : PAGE_SIZE
    const [msgRes, taskRes] = await Promise.all([
      fetch(`${API}/admin/agents/${id}/messages?limit=${msgLimit}`, { headers: authHeaders() }),
      fetch(`${API}/admin/agents/${id}/tasks`, { headers: authHeaders() }),
    ])
    // 已发起更新的 loadDetail：只丢弃「写 tasks UI」；会话 chatLog 仍按 id 写入，互不串台
    if (msgRes.status === 401 || taskRes.status === 401) { onUnauthorized?.(); return }
    const msgData = await msgRes.json().catch(() => ({}))
    const taskData = await taskRes.json().catch(() => ({}))
    if (!msgRes.ok) return
    // 选中对话时 pc-viewer 已 mark-read；本地同步去掉蓝徽标 / 「未读」区
    setAgents((list) => list.map((a) => (a.id === id && a.task_unread ? { ...a, task_unread: false } : a)))
    // 任务条是全局状态：只更新「当前正在看」的那位，避免 A 刷新写到 B 的进度区
    if (viewRef.current.selectedId === id && gen === detailLoadGen.current) {
      setTasks(taskData.items || [])
    }
    // force:结束后用 DB 校准全文;若 DB 被延迟 compact 清短则保留本地流式正文
    if (force || preferDb || !getAgentSession(id).loading) {
      const fromDb = mapMsgs(msgData.items)
      let next
      if (preferDb) {
        // 保留「加载更早」留下的、本页之前的本地消息；本页完全以 DB 时间线为准
        const oldestDb = fromDb[0]?.id
        const olderLocal = (getAgentSession(id).chatLog || []).filter(
          (m) => m?.id != null && oldestDb != null && Number(m.id) < Number(oldestDb),
        )
        next = [...olderLocal, ...fromDb]
      } else if (force) {
        next = coalesceChatLog(getAgentSession(id).chatLog, fromDb)
      } else {
        next = fromDb
      }
      // 划选复制中不要整表替换聊天 DOM（仅当前窗口有选区）
      const skipDom = viewRef.current.selectedId === id && selectionInside(boxRef.current)
      if (!skipDom) {
        setAgentChatLog(id, next)
      }
      patchAgentSession(id, {
        totalMessages: msgData.total || 0,
        hasMore: !!msgData.has_more,
        convId: msgData.conversation_id || 0,
      })
    }
    // 补齐挂起授权（始终写回请求的 id，不跟当前选中走）
    const conv = msgData.conversation_id || local.convId
    if (conv) {
      fetch(`${API}/permissions/pending?conversation_id=${conv}`)
        .then((r) => r.json())
        .then((d) => {
          const items = d.items || []
          if (items.length) {
            patchAgentSession(id, {
              permQueue: dedupPerm([...(getAgentSession(id).permQueue || []), ...items]),
            })
          }
        })
        .catch(() => {})
    }
  }

  async function loadOlder() {
    if (!selectedId || sess.loadingMore || !sess.hasMore || loading) return
    const agentId = selectedId
    const oldestId = chatLog.find((m) => m.id)?.id
    if (!oldestId) return
    const el = boxRef.current
    const prevH = el ? el.scrollHeight : 0
    patchAgentSession(agentId, { loadingMore: true })
    try {
      const res = await fetch(
        `${API}/admin/agents/${agentId}/messages?before_id=${oldestId}&limit=${PAGE_SIZE}`,
        { headers: authHeaders() },
      )
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json()
      const older = mapMsgs(d.items)
      // 始终写回发起加载的 agentId，切换选中也不会串到别人会话
      setAgentChatLog(agentId, (prev) => {
        const ids = new Set(prev.map((m) => m.id).filter(Boolean))
        const merged = [...older.filter((m) => !ids.has(m.id)), ...prev]
        return merged
      })
      patchAgentSession(agentId, {
        hasMore: !!d.has_more,
        totalMessages: d.total || getAgentSession(agentId).totalMessages,
      })
      if (viewRef.current.selectedId === agentId) {
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevH
        })
      }
    } finally {
      patchAgentSession(agentId, { loadingMore: false })
    }
  }

  useEffect(() => { loadAgents() /* eslint-disable-next-line */ }, [])

  // 切换数字人时先清理旧队列徽标，等待新队列状态回传。
  useEffect(() => {
    setTaskQueueBadge(0)
  }, [selectedId])

  // 从「数字人管理」卡片 / 灵动岛跳转：选中并打开设置 / 招聘；顺带补拉审批
  useEffect(() => {
    if (!focusAgentId) return
    setSelectedId(focusAgentId)
    void pullPendingForAgent(focusAgentId, { promoteRequestId: focusApprovalRequestId })
    if (openSettings) {
      const a = agents.find((x) => x.id === focusAgentId)
      if (a) {
        setRenameDraft(a.name || '')
        setRulesDraft(a.rules_prompt || '')
        setPolicyDraft(policyFromAgent(a))
        setContextWindowDraft(a.context_window_tokens || 1000000)
        setJellyColorDraft(resolveJellyColor(a))
      }
      setSettingsTab('basic')
      setSettingsOpen(true)
    }
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAgentId, openSettings])

  // 灵动岛审批深链：主动拉取 pending 并把指定命令提到首位（不依赖内存里是否还有旧队列）
  useEffect(() => {
    if (!focusApprovalRequestId || !selectedId) return undefined
    // 若 App 仍带着 focusAgentId 且尚未切到目标人，先等选中对齐
    if (focusAgentId && selectedId !== focusAgentId) return undefined
    let cancelled = false
    const want = focusApprovalRequestId
    const agentId = selectedId
    ;(async () => {
      // 最多重试几次：agents / conversation_id 可能稍晚才就绪
      for (let i = 0; i < 8 && !cancelled; i += 1) {
        const queue = await pullPendingForAgent(agentId, { promoteRequestId: want })
        if (cancelled) return
        const index = (queue || []).findIndex((item) => item.request_id === want)
        if (index >= 0) {
          requestAnimationFrame(() => boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' }))
          onApprovalFocusConsumed?.()
          return
        }
        await new Promise((r) => setTimeout(r, 400))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusApprovalRequestId, selectedId, focusAgentId])

  useEffect(() => {
    if (!openHire) return
    setTalentMarketOpen(true)
    onHireConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHire])

  useEffect(() => {
    fetch(`${API}/workspaces`)
      .then((r) => r.json())
      .then((d) => setWorkspaces((d.items || d || []).filter((w) => (w.type || 'code') === 'code')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected) {
      setRenameDraft(''); setRulesDraft(''); setTasks([])
      return
    }
    setRenameDraft(selected.name || '')
    setRulesDraft(selected.rules_prompt || '')
    setPolicyDraft(policyFromAgent(selected))
    loadDetail(selected.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, conversationRefreshKey, selected?.id])

  // 切换同事时清空未发送贴图
  useEffect(() => {
    setPendingImages((prev) => {
      revokePendingImages(prev)
      return []
    })
    setLightboxSrc('')
  }, [selectedId])

  /** 把对话区钉在底部（双 rAF 等用户气泡 / RunStatus 布局完成） */
  function scrollChatToBottom() {
    stickBottomRef.current = true
    const el = boxRef.current
    if (!el || selectionInside(el)) return
    pinningScrollRef.current = true
    const pin = () => { el.scrollTop = el.scrollHeight }
    pin()
    requestAnimationFrame(() => {
      pin()
      requestAnimationFrame(() => {
        pin()
        pinningScrollRef.current = false
      })
    })
  }

  useEffect(() => {
    if (!active || !stickBottomRef.current) return
    scrollChatToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLog, loading, active, permQueue.length])

  /** 刷新后无本地 SSE：按服务端 running 恢复 loading，并在终态清掉「幽灵忙碌」 */
  function syncLoadingFromAgentStatus(list) {
    for (const a of list || []) {
      const id = a?.id
      if (!id) continue
      const local = getAgentSession(id)
      const remoteBusy =
        a.status === 'running' ||
        a.status === 'busy' ||
        a.status === 'waiting' ||
        a.status === 'compressing' ||
        a.status === '插话中' ||
        a.status === 'initializing'
      // 本页正挂着 Ask SSE（有 abort）时不干涉
      if (local.abort) continue
      if (remoteBusy && (!local.loading || !local.runtimeDetail)) {
        const restoredRuntime = local.runtimeDetail || runtimeFromActiveAgent(a)
        const startedMs = restoredRuntime?.startedAt || Date.now()
        patchAgentSession(id, {
          loading: true,
          runStartedAt: startedMs,
          liveActivity: local.liveActivity || { tool: '', summary: '后台运行中…', at: Date.now() },
          agentPhase: local.agentPhase || 'working',
          // 页面刷新会清空模块内存；从服务端 running 状态补回 Runtime Detail 按钮。
          runtimeDetail: restoredRuntime,
        })
      } else if (!remoteBusy && local.loading && !local.abort) {
        patchAgentSession(id, {
          loading: false, runStartedAt: 0, liveActivity: null, agentPhase: '', interrupting: false,
        })
      }
    }
  }

  useEffect(() => {
    if (!active) return undefined
    let stopped = false
    let timer = 0
    const pollMs = () => {
      const { selectedId: sid, agents: list } = viewRef.current
      const selectedViewing = list.some((a) => a.id === sid && a.mobile_viewing)
      const busy =
        anyAgentLoading() ||
        selectedViewing ||
        list.some(
          (a) =>
            a.status === 'running' ||
            a.status === 'compressing' ||
            a.status === 'initializing' ||
            a.occupancy?.source_type === 'CLONE_INIT',
        )
      return busy ? 2000 : 4000
    }
    const tick = () => {
      const headers = authHeaders()
      if (!hasBearerToken(headers)) return
      const sid = viewRef.current.selectedId
      // 只刷新名单，不改选中（避免状态变更时对话窗跳到别人）
      Promise.resolve(loadAgents()).then(() => {
        syncLoadingFromAgentStatus(viewRef.current.agents)
      }).catch(() => {})
      if (sid) {
        fetch(`${API}/admin/agents/${sid}/tasks`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (viewRef.current.selectedId === sid) setTasks(d.items || [])
          })
          .catch(() => {})
        const local = getAgentSession(sid)
        // 本机 SSE 流式中跳过；刷新后恢复的 loading（无 abort）仍要轮询消息
        if (!local.loading || !local.abort) {
          void loadDetail(sid, { force: true })
        }
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      if (stopped) return
      timer = window.setTimeout(() => {
        tick()
        schedule()
      }, pollMs())
    }
    schedule()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function onChatScroll() {
    const el = boxRef.current
    if (!el) return
    if (pinningScrollRef.current) return
    // 阈值略放宽：亚像素 / RunStatus 增高时仍视为贴底
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96
    if (el.scrollTop < 40) loadOlder()
  }

  async function createAgent(e) {
    e?.preventDefault?.()
    if (busy) return
    setBusy(true)
    setCreateErr('')
    try {
      const res = await fetch(`${API}/admin/agents`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: newName.trim() || '未命名员工',
          engine: newEngine,
          context_window_tokens: newContextWindow,
          rules_prompt: newRules,
          allow_write: !!newPolicy.allow_write,
          allow_network: !!newPolicy.allow_network,
          allow_rm: !!newPolicy.allow_rm,
          workspace_path: newPolicy.workspace_bound ? (newPolicy.workspace_path || '') : '',
          schedule_enabled: !!newPolicy.schedule_enabled,
          schedule_cron: newPolicy.schedule_enabled ? (newPolicy.schedule_cron || '') : '',
          schedule_label: newPolicy.schedule_enabled ? (newPolicy.schedule_label || '') : '',
          ...jellyColorPayload(newJellyColor),
        }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateErr(d.error || '创建失败')
        return
      }
      // 先插进未入组，避免等列表接口时页面像没点上。
      if (d?.id) {
        const created = {
          ...d,
          folder_id: Number(d.folder_id) || 0,
          jelly_color: d.jelly_color || newJellyColor,
        }
        setAgents((prev) => [created, ...prev.filter((a) => a.id !== created.id)])
        setSelectedId(created.id)
        setAgentSearch('')
      }
      setCreateOpen(false)
      setNewPolicy(emptyPolicy())
      setNewJellyColor(assignJellyColor(String(Date.now())))
      await loadAgents(d?.id, { forceSelect: true })
      onAgentHired?.(d)
    } catch (err) {
      setCreateErr(err?.message || '创建失败')
    } finally { setBusy(false) }
  }

  async function copyAgent(e) {
    e?.preventDefault?.()
    if (!selected || busy) return
    const name = copyName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/agents/${selected.id}/copy`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name,
          ...jellyColorPayload(copyJellyColor),
        }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json()
      if (!res.ok) { patchAgentSession(selected.id, { error: d.error || '复制失败' }); return }
      setCopyOpen(false)
      await loadAgents(d.id, { forceSelect: true })
    } finally { setBusy(false) }
  }

  async function retryCloneInit() {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/agents/${selected.id}/retry-init`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { patchAgentSession(selected.id, { error: d.error || '重试失败' }); return }
      await loadAgents(selected.id)
    } finally { setBusy(false) }
  }

  async function saveRules() {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/agents/${selected.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: renameDraft.trim() || selected.name,
          context_window_tokens: contextWindowDraft,
          rules_prompt: rulesDraft,
          allow_write: !!policyDraft.allow_write,
          allow_network: !!policyDraft.allow_network,
          allow_rm: !!policyDraft.allow_rm,
          workspace_path: policyDraft.workspace_bound ? (policyDraft.workspace_path || '') : '',
          schedule_enabled: !!policyDraft.schedule_enabled,
          schedule_cron: policyDraft.schedule_enabled ? (policyDraft.schedule_cron || '') : '',
          schedule_label: policyDraft.schedule_enabled ? (policyDraft.schedule_label || '') : '',
          ...jellyColorPayload(jellyColorDraft),
        }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        patchAgentSession(selected.id, { error: d.error || '保存失败' })
        return
      }
      setAgents((prev) => prev.map((a) => (
        a.id === selected.id ? { ...a, jelly_color: jellyColorDraft } : a
      )))
      setSettingsOpen(false)
      await loadAgents(selected.id)
      // 换工作区后可能写入系统提示，刷新对话区
      await loadDetail(selected.id, { force: true })
    } finally { setBusy(false) }
  }

  async function createFolder(e) {
    e?.preventDefault?.()
    if (busy) return
    const name = folderCreateName.trim() || '新建工作组'
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/agent-folders`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) return
      setFolderCreateOpen(false)
      setFolderCreateName('新建工作组')
      await loadAgents(selectedId)
    } finally { setBusy(false) }
  }

  async function saveFolderEdit(e) {
    e?.preventDefault?.()
    if (!folderEdit || busy) return
    const name = folderEditName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/agent-folders/${folderEdit.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) return
      setFolderEdit(null)
      await loadAgents(selectedId)
    } finally { setBusy(false) }
  }

  async function moveAgentToFolder(agentId, folderId) {
    const res = await fetch(`${API}/admin/agents/${agentId}/folder`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ folder_id: folderId || 0 }),
    })
    if (res.status === 401) { onUnauthorized?.(); return }
    await loadAgents(selectedId)
  }

  /** 从工作组移出到未入组 */
  async function removeAgentFromFolder(agentId) {
    await moveAgentToFolder(agentId, 0)
  }

  async function fetchStatusSnapshot() {
    if (!selected || loading) return
    const res = await fetch(`${API}/admin/agents/${selected.id}/status`, { headers: authHeaders() })
    if (res.status === 401) { onUnauthorized?.(); return }
    const d = await res.json()
    if (!res.ok) return
    setAgentChatLog(selected.id, (prev) => [
      ...prev,
      { role: 'status', content: d.text || '', time: Date.now() },
    ])
    stickBottomRef.current = true
    await refreshAgentContext(selected.id, true)
  }

  async function deleteAgent() {
    if (!selected || busy) return
    setDismissTarget(selected)
  }

  /** 统一准备员工设置草稿，现代/经典入口共用，避免打开后字段残留。 */
  function openSelectedSettings(tab = 'basic') {
    if (!selected) return
    setRenameDraft(selected.name || '')
    setRulesDraft(selected.rules_prompt || '')
    setPolicyDraft(policyFromAgent(selected))
    setContextWindowDraft(selected.context_window_tokens || 1000000)
    setJellyColorDraft(resolveJellyColor(selected))
    setSettingsTab(tab)
    setSettingsOpen(true)
    setDetailMoreOpen(false)
  }

  /** 加载设置页「继承记忆」 */
  async function loadLegacyMounts(agentId) {
    if (!agentId) { setLegacyMounts([]); return }
    try {
      const res = await fetch(`${API}/admin/agents/${agentId}/legacy-mounts`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (res.ok) setLegacyMounts(d.items || [])
    } catch {
      setLegacyMounts([])
    }
  }

  async function compressChat() {
    if (!selected || loading || compressing) return
    const id = selected.id
    patchAgentSession(id, { compressing: true, error: '' })
    setAgents((list) => list.map((a) => (
      a.id === id ? { ...a, status: 'compressing', run_started_at: a.run_started_at || new Date().toISOString() } : a
    )))
    try {
      const res = await fetch(`${API}/admin/agents/${id}/compress`, { method: 'POST', headers: authHeaders() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { patchAgentSession(id, { error: d.error || '压缩失败' }); return }
      await loadDetail(id, { force: true })
      await refreshAgentContext(id, true)
    } catch (err) {
      patchAgentSession(id, { error: String(err) })
    } finally {
      patchAgentSession(id, { compressing: false })
      await loadAgents(id)
    }
  }

  async function toggleAuto(v) {
    if (!selected || autoSaving) return
    if (v) {
      const ok = jevReady || (await loadJevReady())
      if (!ok) {
        patchAgentSession(selected.id, { error: '请先在「设置 · JEV」安装并开启 JEV' })
        return
      }
    }
    setAutoSaving(true)
    try {
      let conv = getAgentSession(selected.id).convId || selected.conversation_id
      if (!conv && v) {
        // 尚无会话时补建（不换会话）
        const res = await fetch(`${API}/admin/agents/${selected.id}/ensure-conversation`, { method: 'POST', headers: authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || '创建会话失败')
        conv = d.conversation_id
        patchAgentSession(selected.id, { convId: conv })
        await loadAgents(selected.id)
      }
      if (!conv) { patchAgentSession(selected.id, { autoOn: false }); return }
      const res = await fetch(`${API}/permissions/auto`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ conversation_id: conv, enabled: v }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `自动审核开关失败(${res.status})`)
      }
      patchAgentSession(selected.id, { autoOn: v })
      if (!v) patchAgentSession(selected.id, { permQueue: [] })
      setAgents((list) => list.map((a) => (
        a.id === selected.id ? { ...a, auto_review: v } : a
      )))
    } catch (e) {
      patchAgentSession(selected.id, { autoOn: false, error: String(e.message || e) })
    } finally { setAutoSaving(false) }
  }

  /** 拉取 JEV 是否已开启（自动审核前置）；返回是否可用 */
  async function loadJevReady() {
    try {
      const res = await fetch(`${API}/admin/jevos/settings?force=1`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return false
      }
      const d = await res.json().catch(() => ({}))
      const ok = !!d.enabled && !!d.healthy
      setJevReady(ok)
      setJevHint(ok ? '' : (d.detail || '请先在「设置 · JEV」安装并开启'))
      return ok
    } catch {
      setJevReady(false)
      setJevHint('无法检测 JEV 状态')
      return false
    }
  }

  useEffect(() => {
    if (settingsOpen && settingsTab === 'approval') void loadJevReady()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, settingsTab])

  useEffect(() => {
    setDetailMoreOpen(false)
    setTaskQueueOpen(false)
    setRuntimeDetailOpen(false)
  }, [selectedId])

  /** 开关「命令全部审批通过」并落库 */
  async function toggleApproveAll(v) {
    if (!selected || approveAllSaving) return
    setApproveAllSaving(true)
    try {
      const res = await fetch(`${API}/admin/agents/${selected.id}/auto-approve-all`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: v }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `全部审批通过开关失败(${res.status})`)
      setAgents((list) => list.map((a) => (
        a.id === selected.id ? { ...a, auto_approve_all: v } : a
      )))
      if (v) patchAgentSession(selected.id, { permQueue: [] })
    } catch (e) {
      patchAgentSession(selected.id, { error: String(e.message || e) })
    } finally {
      setApproveAllSaving(false)
    }
  }

  /** 切换任务规划：落库到数字员工配置 */
  async function toggleTaskPlan(v) {
    if (!selected || taskPlanSaving) return
    setTaskPlanSaving(true)
    try {
      const res = await fetch(`${API}/admin/agents/${selected.id}/task-plan`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: v }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `任务规划开关失败(${res.status})`)
      setAgents((list) => list.map((a) => (
        a.id === selected.id ? { ...a, task_plan_enabled: v } : a
      )))
    } catch (e) {
      patchAgentSession(selected.id, { error: String(e.message || e) })
    } finally {
      setTaskPlanSaving(false)
    }
  }

  async function decide(requestId, behavior) {
    if (permBusy) return
    setPermBusy(true)
    try {
      await fetch(`${API}/permissions/decide`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ request_id: requestId, behavior }),
      })
    } finally {
      const q = (getAgentSession(selectedId).permQueue || []).filter((p) => p.request_id !== requestId)
      patchAgentSession(selectedId, { permQueue: q })
      setPermBusy(false)
    }
  }

  function parseSSE(text) {
    const events = []
    let rest = text
    while (true) {
      const idx = rest.indexOf('\n\n')
      if (idx < 0) break
      const block = rest.slice(0, idx)
      rest = rest.slice(idx + 2)
      const line = block.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* ignore */ }
    }
    return { events, rest }
  }

  function applyEvents(agentId, events) {
    for (const ev of events) {
      if (ev.type === 'task_queue_next') {
        pendingQueueNextRef.current = {
          task_id: ev.task_id,
          question: ev.question || '',
          attachments: ev.attachments || [],
          resume_prefix: !!ev.resume_prefix,
        }
        setTqRefreshKey((k) => k + 1)
      } else if (ev.type === 'llm_trace_start' || ev.type === 'llm_trace_end') {
        const local = getAgentSession(agentId)
        patchAgentSession(agentId, {
          runtimeDetail: recordRuntimeLLMTrace(local.runtimeDetail, ev),
        })
      } else if (ev.type === 'activity') {
        const local = getAgentSession(agentId)
        patchAgentSession(agentId, {
          liveActivity: { tool: ev.tool || '', summary: ev.summary || '运行中…', at: Date.now() },
          runtimeDetail: recordRuntimeTool(local.runtimeDetail, ev),
        })
      } else if (ev.type === 'agent_phase') {
        patchAgentSession(agentId, { agentPhase: ev.phase || '' })
      } else if (ev.type === 'chunk') {
        const piece = (ev.content || '').replace(/\\n/g, '\n')
        if (!piece) continue
        setAgentChatLog(agentId, (prev) => {
          const n = [...prev]
          // 命令/引用事件会插在末尾;后续正文必须接到 assistant
          if (n.length && n[n.length - 1].role === 'assistant') {
            const last = n[n.length - 1]
            const cur = last.content || ''
            // 引擎重放已推送段落时跳过，避免「改动」等章节贴两次
            if (!shouldAppendAssistantChunk(cur, piece)) return n
            const next = stripRepeatedAssistantTail(cur + piece)
            n[n.length - 1] = { ...last, content: next }
          } else {
            n.push({ role: 'assistant', content: stripRepeatedAssistantTail(piece), time: Date.now() })
          }
          return n
        })
      } else if (ev.type === 'error') {
        const local = getAgentSession(agentId)
        patchAgentSession(agentId, {
          agentPhase: 'error',
          runtimeDetail: finishAgentRuntime(local.runtimeDetail, 'failed'),
        })
        setAgentChatLog(agentId, (prev) => {
          const n = [...prev]
          if (n.length && n[n.length - 1].role === 'assistant') {
            n[n.length - 1] = { ...n[n.length - 1], content: `❌ ${ev.message || '出错'}`, error: true }
          } else {
            n.push({ role: 'assistant', content: `❌ ${ev.message || '出错'}`, error: true })
          }
          return n
        })
      } else if (ev.type === 'assistant_attachments') {
        const atts = Array.isArray(ev.attachments) ? ev.attachments : []
        if (!atts.length) continue
        const mid = ev.message_id
        setAgentChatLog(agentId, (prev) => {
          const n = [...prev]
          for (let i = n.length - 1; i >= 0; i--) {
            if (n[i].role !== 'assistant') continue
            if (mid && n[i].id && n[i].id !== mid) continue
            n[i] = { ...n[i], id: n[i].id || mid, attachments: atts }
            break
          }
          return n
        })
      } else if (ev.type === 'done') {
        const local = getAgentSession(agentId)
        patchAgentSession(agentId, {
          agentPhase: 'idle',
          runtimeDetail: finishAgentRuntime(local.runtimeDetail, 'completed'),
        })
        if (ev.conversation_id) patchAgentSession(agentId, { convId: ev.conversation_id })
        if (ev.reply_ms) {
          setAgentChatLog(agentId, (prev) => {
            const n = [...prev]
            for (let i = n.length - 1; i >= 0; i--) {
              if (n[i].role === 'assistant') {
                n[i] = { ...n[i], replySec: Math.round(ev.reply_ms / 1000) }
                break
              }
            }
            return n
          })
        }
        // 折叠所有委托小窗
        const inv = { ...(getAgentSession(agentId).invokes || {}) }
        Object.keys(inv).forEach((k) => { inv[k] = { ...inv[k], collapsed: true } })
        patchAgentSession(agentId, { invokes: inv, liveActivity: null })
		// 回合结束后强制探测：Claude 走 /context 真值；勿用 turn usage 冒充占用。
		void refreshAgentContext(agentId, true)
      } else if (ev.type === 'invoke_status') {
        const id = String(ev.callee_id)
        const inv = { ...(getAgentSession(agentId).invokes || {}) }
        inv[id] = {
          ...(inv[id] || {}),
          calleeId: ev.callee_id,
          name: ev.callee_name || inv[id]?.name || `#${ev.callee_id}`,
          status: ev.status || 'waiting',
          message: ev.message || '',
          collapsed: false,
        }
        patchAgentSession(agentId, { invokes: inv })
      } else if (ev.type === 'invoke_result' || ev.type === 'invoke_quote') {
        const id = String(ev.callee_id)
        const inv = { ...(getAgentSession(agentId).invokes || {}) }
        inv[id] = {
          ...(inv[id] || {}),
          calleeId: ev.callee_id,
          name: ev.callee_name || inv[id]?.name,
          status: ev.error ? 'error' : 'done',
          content: ev.content || inv[id]?.content || '',
          collapsed: !!ev.collapsed || ev.type === 'invoke_quote',
        }
        patchAgentSession(agentId, { invokes: inv })
        if (ev.type === 'invoke_quote' && ev.content) {
          setAgentChatLog(agentId, (prev) => [
            ...prev,
            {
              role: 'invoke_quote',
              content: ev.content,
              calleeId: ev.callee_id,
              calleeName: ev.callee_name,
              collapsed: true,
              time: Date.now(),
            },
          ])
        }
      } else if (ev.type === 'usage') {
        const turn = Number(ev.turn_tokens) || (
          Number(ev.input_tokens || 0) + Number(ev.output_tokens || 0)
          + Number(ev.cache_read_tokens || 0) + Number(ev.cache_write_tokens || 0)
        )
        const patch = {
          runtimeDetail: recordRuntimeUsage(getAgentSession(agentId).runtimeDetail, ev),
        }
        if (turn > 0) patch.taskTokens = turn
		// SSE usage 是本轮统计，只记录任务消耗；圆环统一由 /context 刷新。
        if (Object.keys(patch).length) patchAgentSession(agentId, patch)
      } else if (ev.type === 'task_progress') {
        // 触发 tasks 刷新由轮询承接
      } else if (ev.type === 'system_note') {
        setAgentChatLog(agentId, (prev) => [
          ...prev,
          { role: 'system', content: ev.content || '系统提示', time: Date.now() },
        ])
      } else if (ev.type === 'context_compacted') {
		// 压缩后的真实上下文值以随后 rollout token_count 快照为准。
        // 运行中不拆毁流式气泡（Codex 常在回合末尾发 compact，否则回复会闪现后消失）
        if (getAgentSession(agentId).loading) {
          setAgentChatLog(agentId, (prev) => [
            ...prev,
            { role: 'system', content: ev.content || '📦 上下文已由引擎压缩，会话已保留', time: Date.now() },
          ])
        } else {
          setAgentChatLog(agentId, (prev) => {
            let lastUser = null
            let lastAsst = null
            let userIdx = -1
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'user' && (prev[i].content || '').trim()) {
                userIdx = i
                lastUser = { role: 'user', content: prev[i].content, time: prev[i].time || Date.now() }
                break
              }
            }
            if (userIdx >= 0) {
              for (let i = prev.length - 1; i > userIdx; i--) {
                if (prev[i].role === 'assistant' && (prev[i].content || '').trim()) {
                  lastAsst = {
                    role: 'assistant',
                    content: prev[i].content,
                    time: prev[i].time || Date.now(),
                    replySec: prev[i].replySec,
                  }
                  break
                }
              }
            }
            const next = [
              { role: 'assistant', content: ev.content || '📦 上下文已由引擎压缩，会话已保留', time: Date.now() },
            ]
            if (lastUser) next.push(lastUser)
            if (lastAsst) next.push(lastAsst)
            return next
          })
        }
      } else if (ev.type === 'permission_request') {
        patchAgentSession(agentId, {
          permQueue: dedupPerm([...(getAgentSession(agentId).permQueue || []), ev]),
          liveActivity: {
            tool: ev.tool_name || 'Tool',
            summary: `等待授权 · ${(ev.summary || ev.tool_name || '').slice(0, 72)}`,
            at: Date.now(),
          },
        })
      } else if (ev.type === 'permission_auto') {
        setAgentChatLog(agentId, (prev) => [
          ...prev,
          { role: 'auto', content: `${ev.tool_name} · ${(ev.summary || '').slice(0, 80)}`, note: ev.note },
        ])
        patchAgentSession(agentId, {
          liveActivity: {
            tool: ev.tool_name || 'Tool',
            summary: `自动放行 · ${(ev.summary || '').slice(0, 64)}`,
            at: Date.now(),
          },
        })
      } else if (ev.type === 'command') {
        const local = getAgentSession(agentId)
        patchAgentSession(agentId, {
          runtimeDetail: recordRuntimeTool(local.runtimeDetail, ev),
        })
        setAgentChatLog(agentId, (prev) => [
          ...prev,
          {
            role: 'command',
            content: ev.summary || ev.tool_name,
            decision: ev.decision || 'allow',
            decidedBy: ev.decided_by || '',
            risk: ev.risk || '',
            meaning: ev.meaning || '',
            note: ev.note || ev.output || '',
            time: Date.now(),
          },
        ])
      } else if (ev.type === 'permission_resolved') {
        patchAgentSession(agentId, {
          permQueue: (getAgentSession(agentId).permQueue || []).filter((p) => p.request_id !== ev.request_id),
        })
      }
    }
  }

  async function refreshAgentContext(agentId, fresh = false) {
    if (!agentId) return
    try {
      const q = fresh ? '?fresh=1' : ''
      const res = await fetch(`${API}/admin/agents/${agentId}/context${q}`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) return
      const d = await res.json()
      const src = d.source || ''
      let estimated = !!d.estimated
      // 兼容旧后端无 estimated：仅 Claude probe 视为精确
      if (d.estimated === undefined || d.estimated === null) {
        estimated = src !== 'probe'
      }
      patchAgentSession(agentId, {
        contextUsed: Number(d.used_tokens) || 0,
        contextWindow: Number(d.window_tokens) || 0,
        contextEstimated: estimated,
		contextSource: src,
		contextTotalTokens: Number(d.total_tokens) || 0,
		contextUpdatedAt: Number(d.context_updated_at) || 0,
		contextAnomaly: d.anomaly || '',
      })
    } catch { /* ignore */ }
  }

  async function loadLatestRuntime(agentId) {
    if (!agentId) return null
    try {
      const res = await fetch(`${API}/admin/agent-audit/latest?agent_id=${agentId}`, { headers: authHeaders() })
      if (res.status === 401) { onUnauthorized?.(); return null }
      if (!res.ok) return null
      const data = await res.json().catch(() => ({}))
      const runtime = runtimeFromAudit(data.item)
      patchAgentSession(agentId, { lastRuntimeDetail: runtime })
      return runtime
    } catch {
      return null
    }
  }

  async function sendQuestion(agentId, q, attachments = [], opts = {}) {
    const atts = (attachments || []).filter((a) => a?.url || a?.id)
    const taskId = Number(opts.taskId) || 0
    const resumePrefix = !!opts.resumePrefix
    const ac = new AbortController()
    // 先钉底再改会话，避免中间一次 effect 读到旧的 stickBottom=false
    stickBottomRef.current = true
    const startedAt = Date.now()
    patchAgentSession(agentId, {
      loading: true, error: '', runStartedAt: startedAt, abort: ac, interrupting: false, invokes: {},
      agentPhase: 'working',
      taskTokens: 0,
      liveActivity: { tool: '', summary: '启动中…', at: Date.now() },
      runtimeDetail: beginAgentRuntime(startedAt),
      lastRuntimeDetail: null,
    })
    // pending: 轮询 force 校准时由 coalesce 保留，避免乐观气泡被冲掉
    setAgentChatLog(agentId, (prev) => [
      ...prev,
      { role: 'user', content: q, attachments: atts, time: Date.now(), pending: true },
    ])
    scrollChatToBottom()
    pendingQueueNextRef.current = null
    try {
      const res = await fetch(`${API}/admin/agents/${agentId}/ask`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          question: q,
          attachments: atts,
          task_id: taskId || undefined,
          resume_prefix: resumePrefix || undefined,
        }),
        signal: ac.signal,
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parsed = parseSSE(buf)
        buf = parsed.rest
        applyEvents(agentId, parsed.events)
        // 流式期间刷新任务进度
        if (parsed.events.some((e) => e.type === 'task_progress' || e.type === 'invoke_status')) {
          fetch(`${API}/admin/agents/${agentId}/tasks`, { headers: authHeaders() })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d && selectedId === agentId) setTasks(d.items || []) })
            .catch(() => {})
        }
      }
      try {
        await loadAgents(agentId)
        // preferDb：用落库时间线替换 SSE 挂尾命令，保证最终回复出现在视口底部
        await loadDetail(agentId, { force: true, preferDb: true })
      } catch (postErr) {
        // 回合已结束；刷新列表失败不掩盖委托/汇总错误
        console.warn('ask post-refresh failed', postErr)
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        patchAgentSession(agentId, {
          runtimeDetail: finishAgentRuntime(getAgentSession(agentId).runtimeDetail, 'interrupted'),
        })
        const isInterrupt = !!getAgentSession(agentId).pendingInterrupt
        if (!isInterrupt) {
          setAgentChatLog(agentId, (prev) => {
            const n = [...prev]
            for (let i = n.length - 1; i >= 0; i--) {
              if (n[i].role === 'assistant') {
                n[i] = { ...n[i], content: (n[i].content || '') + '\n\n⏹ 已停止' }
                return n
              }
            }
            n.push({ role: 'assistant', content: '⏹ 已停止', error: true, time: Date.now() })
            return n
          })
        }
      } else {
        patchAgentSession(agentId, {
          error: String(err),
          runtimeDetail: finishAgentRuntime(getAgentSession(agentId).runtimeDetail, 'failed'),
        })
      }
    } finally {
      const currentSession = getAgentSession(agentId)
      const pending = currentSession.pendingInterrupt
      const pendingAtts = currentSession.pendingAttachments || []
      const queueNext = pendingQueueNextRef.current
      pendingQueueNextRef.current = null
      patchAgentSession(agentId, {
        loading: false, abort: null, runStartedAt: 0, pendingInterrupt: '', pendingAttachments: [],
        interrupting: false, liveActivity: null, agentPhase: '',
        runtimeDetail: finishAgentRuntime(currentSession.runtimeDetail, currentSession.error ? 'failed' : 'completed'),
      })
      setTqRefreshKey((k) => k + 1)
      // fresh=true：空闲时拉 Claude /context 或 Codex session 真值，避免一直停在 turn usage 估算
      await refreshAgentContext(agentId, true)
      await loadLatestRuntime(agentId)
      // 旧插话路径兼容；优先走服务端 task_queue_next
      if (queueNext?.task_id) {
        const nextAtts = Array.isArray(queueNext.attachments) ? queueNext.attachments : []
        await sendQuestion(agentId, queueNext.question || '', nextAtts, {
          taskId: queueNext.task_id,
          resumePrefix: !!queueNext.resume_prefix,
        })
        return
      }
      if (pending || pendingAtts.length) await sendQuestion(agentId, pending || '', pendingAtts)
    }
  }

  /** 粘贴/拖入图片加入预览 */
  function ingestComposerImages(files) {
    if (!files?.length) return
    setPendingImages((prev) => {
      const { next, overflow } = appendPendingImages(prev, files)
      if (overflow) {
        patchAgentSession(selectedId, { error: `最多附带 ${MAX_CHAT_IMAGES} 张图片` })
      }
      return next
    })
  }

  function onComposerPaste(e) {
    const files = imageFilesFromDataTransfer(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    ingestComposerImages(files)
  }

  function onComposerDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onComposerDrop(e) {
    const files = imageFilesFromDataTransfer(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    ingestComposerImages(files)
  }

  function removePendingImage(localId) {
    setPendingImages((prev) => {
      const hit = prev.find((x) => x.localId === localId)
      if (hit) revokePendingImages([hit])
      return prev.filter((x) => x.localId !== localId)
    })
  }

  /** ChatGPT 式：默认一行，内容增多时向上增高（受 max-height 限制） */
  function autosizeComposer() {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    autosizeComposer()
  }, [question])

  /** 输入 @ 时弹出同事列表 */
  function onComposerChange(e) {
    const v = e.target.value
    setQuestion(v)
    const caret = e.target.selectionStart || v.length
    const before = v.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at >= 0 && !/\s/.test(before.slice(at + 1)) && !before.slice(at).includes('](')) {
      setMentionOpen(true)
      setMentionIdx(0)
    } else {
      setMentionOpen(false)
    }
  }

  function insertMention(agent) {
    const el = composerRef.current
    const v = question
    const caret = el?.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const after = v.slice(caret)
    const at = before.lastIndexOf('@')
    const token = `@[${agent.name}](#agent:${agent.id}) `
    const next = (at >= 0 ? before.slice(0, at) : before) + token + after
    setQuestion(next)
    setMentionOpen(false)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = (at >= 0 ? at : caret) + token.length
      el.setSelectionRange(pos, pos)
      autosizeComposer()
    })
  }

  async function ask() {
    if (!selected) return
    if (selected.status === 'initializing' || isCloneInitBusy(selected)) return
    if (groupOffer) return // 岔路面板打开时先别叠发
    if (tqChoice) return
    const q = question.trim()
    const pending = pendingImages
    if (!q && !pending.length) return
    if (attachBusy) return
    const id = selected.id
    const s = getAgentSession(id)
    let atts = []
    if (pending.length) {
      setAttachBusy(true)
      try {
        atts = await ensureUploadedAttachments(
          pending,
          (localId, patch) => {
            setPendingImages((prev) => prev.map((x) => (x.localId === localId ? { ...x, ...patch } : x)))
          },
          { endpoint: `${API}/admin/chat-images`, headers: authHeaders() },
        )
      } catch (err) {
        patchAgentSession(id, { error: String(err.message || err) })
        setAttachBusy(false)
        return
      }
      setAttachBusy(false)
    }
    // 忙碌：弹层二选一（与 @ 多人群聊互斥：有群聊资格则不提供入队）
    if (s.loading) {
      const { canOfferGroup } = buildGroupMemberSet(id, q)
      setTqChoice({ question: q, attachments: atts, hideEnqueue: !!canOfferGroup })
      setQuestion('')
      revokePendingImages(pending)
      setPendingImages([])
      return
    }
    setQuestion('')
    revokePendingImages(pending)
    setPendingImages([])
    // 3～5 人（含当前窗口）→ 5s「生成群聊」岔路；队列活跃时不做群聊 offer
    const { memberIds, canOfferGroup } = buildGroupMemberSet(id, q)
    let queueActive = false
    try {
      const res = await fetch(`${API}/admin/agents/${id}/task-queue`, { headers: authHeaders() })
      if (res.ok) {
        const d = await res.json()
        queueActive = Number(d.active) > 0
      }
    } catch { /* ignore */ }
    if (canOfferGroup && !queueActive) {
      setGroupOffer({ memberIds, question: q, attachments: atts })
      return
    }
    await sendQuestion(id, q, atts)
  }

  /** 弹层：打断并优先执行 */
  async function onTqInterrupt() {
    if (!selected || !tqChoice || tqChoiceBusy) return
    const id = selected.id
    const q = tqChoice.question
    const atts = tqChoice.attachments || []
    setTqChoiceBusy(true)
    try {
      const res = await fetch(`${API}/admin/agents/${id}/task-queue/interrupt`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question: q, attachments: atts }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `打断失败(${res.status})`)
      setTqChoice(null)
      const s = getAgentSession(id)
      s.abort?.abort()
      setTqRefreshKey((k) => k + 1)
      await sendQuestion(id, q, atts, { taskId: d.id })
    } catch (err) {
      patchAgentSession(id, { error: String(err.message || err) })
    } finally {
      setTqChoiceBusy(false)
    }
  }

  /** 弹层：加入队列末尾 */
  async function onTqEnqueue() {
    if (!selected || !tqChoice || tqChoiceBusy) return
    const id = selected.id
    const q = tqChoice.question
    const atts = tqChoice.attachments || []
    setTqChoiceBusy(true)
    try {
      const res = await fetch(`${API}/admin/agents/${id}/task-queue`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question: q, attachments: atts }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `入队失败(${res.status})`)
      setTqChoice(null)
      setTqRefreshKey((k) => k + 1)
      // 入队时刚好空闲：服务端已 claim，需立刻 Ask，否则会一直挂在队列里
      const kick = d.kickoff || (d.status === 'running' ? d : null)
      if (kick?.id) {
        let kickAtts = atts
        if (kick.attachments_json) {
          try { kickAtts = JSON.parse(kick.attachments_json) } catch { /* keep */ }
        }
        await sendQuestion(id, kick.question || q, kickAtts, {
          taskId: kick.id,
          resumePrefix: !!kick.resume_hint,
        })
      }
    } catch (err) {
      patchAgentSession(id, { error: String(err.message || err) })
    } finally {
      setTqChoiceBusy(false)
    }
  }

  /** 继续被 Stop 挂起的队列 */
  async function onTqContinue() {
    if (!selectedId) return
    try {
      const res = await fetch(`${API}/admin/agents/${selectedId}/task-queue/continue`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `继续失败(${res.status})`)
      setTqRefreshKey((k) => k + 1)
      const task = d.task
      if (!task?.id) return
      const atts = (() => {
        try {
          return task.attachments_json ? JSON.parse(task.attachments_json) : []
        } catch {
          return []
        }
      })()
      await sendQuestion(selectedId, task.question || '', atts, {
        taskId: task.id,
        resumePrefix: !!d.resume_prefix || !!task.resume_hint,
      })
    } catch (err) {
      patchAgentSession(selectedId, { error: String(err.message || err) })
    }
  }

  /** 岔路超时 / 选并行：关闭面板并走现有 ask SSE */
  async function resolveGroupOfferParallel() {
    const offer = groupOffer
    setGroupOffer(null)
    if (!offer || !selectedId) return
    await sendQuestion(selectedId, offer.question, offer.attachments || [])
  }

  /** 点「生成群聊」：建群并跳转群聊页，本轮不跑并行 invoke */
  async function resolveGroupOfferCreate() {
    const offer = groupOffer
    if (!offer || !selectedId) return
    setGroupCreating(true)
    try {
      const res = await fetch(`${API}/admin/group-chats`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          from_agent_id: selectedId,
          member_ids: offer.memberIds.filter((mid) => Number(mid) !== Number(selectedId)),
          seed_question: offer.question,
        }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      setGroupOffer(null)
      onOpenGroupChat?.(d.id)
    } catch (err) {
      patchAgentSession(selectedId, { error: String(err.message || err) })
      // 建群失败：回落到并行，避免问题丢了
      setGroupOffer(null)
      await sendQuestion(selectedId, offer.question, offer.attachments || [])
    } finally {
      setGroupCreating(false)
    }
  }

  async function stopRun() {
    if (!selected) return
    const id = selected.id
    patchAgentSession(id, { pendingInterrupt: '', pendingAttachments: [], interrupting: false })
    getAgentSession(id).abort?.abort()
    try {
      await fetch(`${API}/admin/agents/${id}/stop`, { method: 'POST', headers: authHeaders() })
    } catch { /* ignore */ }
    setTqRefreshKey((k) => k + 1)
    patchAgentSession(id, { loading: false, abort: null, runStartedAt: 0, liveActivity: null })
    setAgentChatLog(id, (prev) => {
      const n = [...prev]
      const last = n[n.length - 1]
      if (last?.role === 'assistant') {
        n[n.length - 1] = {
          ...last,
          content: `${(last.content || '').trim() ? `${last.content}\n\n` : ''}⏹ 已终止本次对话`,
          error: true,
        }
      } else {
        n.push({ role: 'assistant', content: '⏹ 已终止本次对话', error: true, time: Date.now() })
      }
      return n
    })
    await loadAgents(id)
  }

  function onKeyDown(e) {
    if (mentionOpen && mentionCandidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        insertMention(mentionCandidates[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        setMentionOpen(false)
        return
      }
    }
    // Ctrl/Cmd+Enter 发送；单独 Enter 换行，避免字没打完就发出
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      if (selected?.status === 'initializing' || isCloneInitBusy(selected)) return
      ask()
    }
  }

  function liveRunSec(a) {
    const local = getAgentSession(a.id)
    if (local.loading && local.runStartedAt) return Math.max(1, Math.round((Date.now() - local.runStartedAt) / 1000))
    if ((a.status === 'running' || a.status === 'compressing' || local.compressing) && a.run_started_at) {
      return Math.max(1, runningElapsedSec(a.run_started_at))
    }
    return 0
  }

  const statusLabel = (a) => {
    const local = getAgentSession(a.id)
    if (isCloneInitBusy(a)) return t('status.organizing')
    if (local.compressing || a.status === 'compressing') return t('status.compressing')
    if (a.status === 'initializing') return t('status.initializing')
    if (local.loading) return t('status.busy')
    return statusZh(a.status, t)
  }

  const workflowBusy = isWorkflowBusy(selected)
  const cloneInitBusy = isCloneInitBusy(selected)
  const chatLocked = isChatLocked(selected)
  const liveTask = (tasks || []).find((t) => t.status === 'running' || t.status === 'waiting')
  // 团队占用时不回落到已结束任务；结束后清空进度展示
  const activeTask = liveTask || (workflowBusy ? {
    task_name: selected?.occupancy?.task_name || selected?.occupancy?.source_name || '项目协作任务',
    status: 'running',
    progress: 0,
    message: '项目协作执行中…',
    payload: {},
  } : null)
  const activeProgress = Math.min(100, Math.max(0, activeTask?.progress || 0))
  /** 优先 step_items（v1 协议）；兼容旧 steps 字符串数组 */
  const planPayload = activeTask?.payload || {}
  const stepItems = Array.isArray(planPayload.step_items) ? planPayload.step_items : null
  const activeSteps = stepItems
    ? stepItems.map((s) => s?.title || s?.Title || '')
    : (planPayload.steps || [])
  const activeStepIdx = planPayload.current_step ?? 0
  const failedStepIdx = planPayload.failed ? (planPayload.failed_step ?? -1) : -1
  const planPhase = planPayload.phase || ''
  function stepClass(i) {
    if (stepItems?.[i]?.status) {
      const st = stepItems[i].status
      if (st === 'failed') return 'failed'
      if (st === 'done' || st === 'skipped') return 'done'
      if (st === 'active') return 'current'
      return ''
    }
    if (i === failedStepIdx) return 'failed'
    if (i < activeStepIdx) return 'done'
    if (i === activeStepIdx) return 'current'
    return ''
  }

  const searchQ = agentSearch.trim().toLowerCase()
  const filteredAgents = useMemo(() => {
    if (!searchQ) return agents
    return agents.filter((a) => (a.name || '').toLowerCase().includes(searchQ))
  }, [agents, searchQ])
  // 依赖 sessVer：本地 loading 变化时刷新「运行中」镜像区
  const busyAgents = useMemo(
    () => filteredAgents.filter((a) => isAgentBusy(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessVer 驱动 session 重算
    [filteredAgents, sessVer],
  )
  /** 任务完成未读（非忙碌）；按完成时间倒序：越早越靠后 */
  const unreadAgents = useMemo(
    () =>
      filteredAgents
        .filter((a) => !!a.task_unread && !isAgentBusy(a))
        .sort((a, b) => unreadAtMs(b) - unreadAtMs(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessVer 驱动 session 重算
    [filteredAgents, sessVer],
  )

  function renderAgentItem(a) {
    const st = statusLabel(a)
    const stClass = isCloneInitBusy(a)
      ? 'initializing'
      : statusClass(getAgentSession(a.id).compressing ? 'compressing' : (getAgentSession(a.id).loading ? 'running' : a.status))
    const runSec = liveRunSec(a)
    const pend = (getAgentSession(a.id).permQueue || []).length
    return (
      <div
        key={a.id}
        role="button"
        tabIndex={0}
        className={`ma-item ${selectedId === a.id ? 'active' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/agent-id', String(a.id))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => setSelectedId(a.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setSelectedId(a.id)
          }
        }}
      >
        <div className="ma-item-head">
          <JellyAvatar
            className="ma-avatar ma-avatar-sm"
            color={resolveJellyColor(a)}
            size={28}
            state={jellyStateFromAgent(a, { loading: getAgentSession(a.id).loading })}
          />
          <strong className="ma-item-name">
            {a.name}
            {a.mobile_viewing ? <MobileViewerIcon /> : null}
          </strong>
          <span className="ma-item-badges">
            {pend > 0 && <span className="admin-badge admin-badge-perm" title="待授权">{pend}</span>}
            {!!a.task_unread && !isAgentBusy(a) && (
              <span className="admin-badge admin-badge-unread" title="任务完成未读">未读</span>
            )}
            <span className={`ma-status st-${stClass}`}>{st}</span>
          </span>
        </div>
        <div className="ma-item-meta">
          <EngineTagWithSkills engine={a.engine} skillCount={a.skill_count} />
          <span className="ma-age-fixed">已运行 {fmtAge(a.created_at)}</span>
          {runSec > 0 ? <span className="ma-runlive">本次 {fmtSec(runSec)}</span>
            : a.last_run_ms > 0 ? <span>上次 {fmtSec(Math.round(a.last_run_ms / 1000))}</span> : null}
          {isWorkflowBusy(a) && onOpenWorkflowRun && a.occupancy?.workflow_run_id > 0 && (
            <button
              type="button"
              className="ma-occ-link"
              onClick={(e) => { e.stopPropagation(); onOpenWorkflowRun(a.occupancy.workflow_run_id) }}
            >
              查看团队任务
            </button>
          )}
        </div>
        <SkillIconStrip icons={a.skill_icons} />
      </div>
    )
  }

  /** 向左收起工作组列表，把横向空间让给对话区。 */
  function toggleAgentList() {
    setListCollapsed((v) => {
      const next = !v
      try { localStorage.setItem('ma_list_collapsed', next ? '1' : '0') } catch { /* 隐私模式忽略 */ }
      return next
    })
  }

  /** 一键展开所有工作组（含未入组）。 */
  function expandAllFolders() {
    setCollapsedFolders({})
  }

  /** 一键折叠所有工作组（含未入组）。 */
  function collapseAllFolders() {
    const next = { root: true }
    for (const f of folders) {
      if (f?.id != null) next[f.id] = true
    }
    setCollapsedFolders(next)
  }

  return (
    <section className={`ma-panel${presentation === 'focus' ? ' ma-panel-focus' : ''}`}>
      <button
        type="button"
        className="ma-list-collapse"
        onClick={toggleAgentList}
        title={listCollapsed ? '展开工作组' : '向左收起工作组'}
        aria-expanded={!listCollapsed}
        aria-label={listCollapsed ? '展开工作组' : '向左收起工作组'}
      >
        <ListCollapseIcon collapsed={listCollapsed} />
      </button>
      <div className="ma-toolbar">
        <h2>数字人对话</h2>
        <div className="ma-toolbar-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => { setFolderCreateName('新建工作组'); setFolderCreateOpen(true) }}
            disabled={busy}
          >
            创建工作组
          </button>
          <button type="button" className="new" onClick={() => setTalentMarketOpen(true)}>＋ 一键招聘</button>
        </div>
      </div>

      <div className={`ma-layout${listCollapsed ? ' is-collapsed' : ''}`}>
        <aside className="ma-list">
          <input
            className="ma-search"
            value={agentSearch}
            onChange={(e) => setAgentSearch(e.target.value)}
            placeholder="搜索数字员工名称…"
          />
          {folders.length > 0 || filteredAgents.some((a) => isUngroupedAgent(a, folders)) ? (
            <div className="ma-fold-toolbar">
              <button type="button" className="ghost ma-fold-btn" onClick={expandAllFolders}>
                全部展开
              </button>
              <button type="button" className="ghost ma-fold-btn" onClick={collapseAllFolders}>
                全部折叠
              </button>
            </div>
          ) : null}
          {filteredAgents.length === 0 && <p className="empty">暂无匹配的数字员工</p>}

          {/* 未读置顶，优先级高于运行中；浅蓝边框；点进对话后已读移出 */}
          {unreadAgents.length > 0 && (
            <div className="ma-folder-block ma-unread-block">
              <div className="ma-folder-head">
                <div className="ma-folder-title">
                  <span className="ma-folder-title-text">未读</span>
                  <span className="ma-folder-title-right">
                    <span className="admin-badge admin-badge-unread ma-folder-badge" title="任务完成未读">
                      {unreadAgents.length}
                    </span>
                  </span>
                </div>
              </div>
              <div className="ma-folder-agents">
                {unreadAgents.map(renderAgentItem)}
              </div>
            </div>
          )}

          {busyAgents.length > 0 && (
            <div className="ma-folder-block ma-running-block">
              <div className="ma-folder-head">
                <div className="ma-folder-title">
                  <span className="ma-folder-title-text">运行中</span>
                  <span className="ma-folder-title-right">
                    <span className="admin-badge ma-folder-badge" title="运行中">
                      {busyAgents.length}
                    </span>
                  </span>
                </div>
              </div>
              <div className="ma-folder-agents">
                {busyAgents.map(renderAgentItem)}
              </div>
            </div>
          )}

          <div
            className="ma-folder-block ma-folder-root"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={(e) => {
              e.preventDefault()
              const id = Number(e.dataTransfer.getData('text/agent-id'))
              if (id) moveAgentToFolder(id, 0)
            }}
          >
            <div className="ma-folder-head">
              <button
                type="button"
                className="ma-folder-title"
                onClick={() => setCollapsedFolders((m) => ({ ...m, root: !m.root }))}
              >
                <span className="ma-folder-title-text">{collapsedFolders.root ? '▸' : '▾'} 未入组</span>
                <span className="ma-folder-title-right">
                  {(() => {
                    const kids = filteredAgents.filter((a) => isUngroupedAgent(a, folders))
                    const { direct, wf } = countFolderBusy(kids)
                    return (
                      <>
                        {wf > 0 && <span className="admin-badge admin-badge-workflow ma-folder-badge" title="项目协作忙碌">{wf}</span>}
                        {direct > 0 && <span className="admin-badge ma-folder-badge" title="直接运行中">{direct}</span>}
                        <span className="muted">{kids.length}</span>
                      </>
                    )
                  })()}
                </span>
              </button>
            </div>
            {(!collapsedFolders.root || !!searchQ) && (
              <div className="ma-folder-agents">
                {filteredAgents.filter((a) => isUngroupedAgent(a, folders)).map(renderAgentItem)}
              </div>
            )}
          </div>

          {folders.map((f) => {
            const kids = filteredAgents.filter((a) => Number(a.folder_id) === Number(f.id))
            if (searchQ && kids.length === 0) return null
            // 搜索时强制展开，避免匹配结果被藏在折叠组里
            const collapsed = !searchQ && !!collapsedFolders[f.id]
            return (
              <div
                key={f.id}
                className="ma-folder-block"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = Number(e.dataTransfer.getData('text/agent-id'))
                  if (id) moveAgentToFolder(id, f.id)
                }}
              >
                <div className="ma-folder-head">
                  <button
                    type="button"
                    className="ma-folder-title"
                    onClick={() => setCollapsedFolders((m) => ({ ...m, [f.id]: !m[f.id] }))}
                  >
                    <span className="ma-folder-title-text">{collapsed ? '▸' : '▾'} {f.name}</span>
                    <span className="ma-folder-title-right">
                      {(() => {
                        const { direct, wf } = countFolderBusy(kids)
                        return (
                          <>
                            {wf > 0 && <span className="admin-badge admin-badge-workflow ma-folder-badge" title="项目协作忙碌">{wf}</span>}
                            {direct > 0 && <span className="admin-badge ma-folder-badge" title="直接运行中">{direct}</span>}
                            <span className="muted">{kids.length}</span>
                          </>
                        )
                      })()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ma-folder-edit"
                    title="编辑工作组"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFolderEdit({ id: f.id, name: f.name })
                      setFolderEditName(f.name || '')
                    }}
                  >
                    编辑
                  </button>
                </div>
                {!collapsed && (
                  <div className="ma-folder-agents">
                    {kids.length === 0
                      ? <p className="ma-folder-empty">工作组空闲 · 把同事拖进来</p>
                      : kids.map(renderAgentItem)}
                  </div>
                )}
              </div>
            )
          })}
        </aside>

        <div className="ma-main ma-main-with-tq">
          {selected ? (
            <TaskQueueRail
              agentId={selected.id}
              authHeaders={authHeaders}
              onUnauthorized={onUnauthorized}
              active={active && !!selected}
              refreshKey={tqRefreshKey}
              onContinue={() => void onTqContinue()}
              open={taskQueueOpen}
              onOpenChange={setTaskQueueOpen}
              onBadgeChange={setTaskQueueBadge}
              showToggle={false}
            />
          ) : null}
          {!selected ? (
            <div className="empty ma-empty ma-empty-hero">
              <div className="ma-empty-icon" aria-hidden="true" />
              <p>还没有选中同事</p>
              <p className="ma-empty-sub">从左侧工作组点选，或点右上角「一键招聘」打开人才市场</p>
            </div>
          ) : (
            <div className="ma-detail">
              <header className="ma-detail-head">
                <div className="ma-detail-title">
                  <JellyAvatar
                    className="ma-avatar ma-avatar-md"
                    color={resolveJellyColor(selected)}
                    size={36}
                    state={sess.loading
                      ? jellyStateFromPhase(sess.agentPhase, 'working')
                      : jellyStateFromAgent(selected)}
                  />
                  <h3 className="ma-detail-name">
                    {selected.name}
                    {selected.mobile_viewing ? <MobileViewerIcon /> : null}
                  </h3>
                  <EngineTagWithSkills engine={selected.engine} skillCount={selected.skill_count} />
                  <span className={`ma-status st-${cloneInitBusy ? 'initializing' : statusClass(getAgentSession(selected.id).compressing ? 'compressing' : (getAgentSession(selected.id).loading ? 'running' : selected.status))}`}>
                    {statusLabel(selected)}
                  </span>
                  {presentation === 'focus' && (
                    <EngineUsageChip
                      engine={selected.engine}
                      authHeaders={authHeaders}
                      onUnauthorized={onUnauthorized}
                      active={active}
                    />
                  )}
                  {workflowBusy && selected.occupancy?.workflow_run_id > 0 && onOpenWorkflowRun && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onOpenWorkflowRun(selected.occupancy.workflow_run_id)}
                    >
                      查看团队任务
                    </button>
                  )}
                  {liveRunSec(selected) > 0 && <span className="ma-runlive">{fmtSec(liveRunSec(selected))}</span>}
                </div>
                <div className="ma-detail-tools">
                  {presentation === 'focus' ? (
                    <>
                      <button
                        type="button"
                        className={`ma-detail-icon-btn${approveAllOn || autoOn ? ' is-on' : ''}`}
                        onClick={() => openSelectedSettings('basic')}
                        title="员工设置"
                        aria-label="员工设置"
                      >
                        <ModernIcon name="settings" />
                        {(approveAllOn || autoOn) && <span className="ma-approve-dot" />}
                      </button>
                      <div
                        className="ma-detail-menu-wrap"
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) setDetailMoreOpen(false)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setDetailMoreOpen(false)
                        }}
                      >
                        <button
                          type="button"
                          className="ma-detail-icon-btn"
                          onClick={() => setDetailMoreOpen((value) => !value)}
                          title="更多操作"
                          aria-label="更多操作"
                          aria-expanded={detailMoreOpen}
                        >
                          <ModernIcon name="menu" />
                        </button>
                        {detailMoreOpen && (
                          <div className="ma-detail-more-menu">
                            {selected.status !== 'initializing' && !cloneInitBusy && (
                              <button
                                type="button"
                                disabled={busy || loading}
                                onClick={() => {
                                  setCopyName(`${selected.name || '未命名员工'} 副本`)
                                  setCopyJellyColor(resolveJellyColor(selected))
                                  setCopyOpen(true)
                                  setDetailMoreOpen(false)
                                }}
                              >复制</button>
                            )}
                            {!workflowBusy && !initializing && !cloneInitBusy && (
                              <>
                                <button type="button" onClick={() => { setDetailMoreOpen(false); fetchStatusSnapshot() }} disabled={loading || compressing}>状态</button>
                                <button type="button" onClick={() => { setDetailMoreOpen(false); compressChat() }} disabled={loading || compressing}>
                                  {compressing ? '压缩记忆…' : '压缩'}
                                </button>
                              </>
                            )}
                            {selected.status === 'error' && Number(selected.cloned_from_id) > 0 && (
                              <button type="button" disabled={busy} onClick={() => { setDetailMoreOpen(false); retryCloneInit() }}>重试初始化</button>
                            )}
                            <hr />
                            <button type="button" className="danger-item" onClick={() => { setDetailMoreOpen(false); deleteAgent() }} disabled={busy || loading}>解聘</button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ghost" onClick={() => openSelectedSettings('basic')}>设置</button>
                      {selected.status !== 'initializing' && !cloneInitBusy && (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy || loading}
                          onClick={() => {
                            setCopyName(`${selected.name || '未命名员工'} 副本`)
                            setCopyJellyColor(resolveJellyColor(selected))
                            setCopyOpen(true)
                          }}
                        >复制</button>
                      )}
                      {!workflowBusy && !initializing && !cloneInitBusy && (
                        <>
                          <button type="button" className="ghost" onClick={fetchStatusSnapshot} disabled={loading || compressing}>状态</button>
                          <button type="button" className="ghost" onClick={compressChat} disabled={loading || compressing}>{compressing ? '压缩记忆…' : '压缩'}</button>
                        </>
                      )}
                      {selected.status === 'error' && Number(selected.cloned_from_id) > 0 && (
                        <button type="button" className="ghost" disabled={busy} onClick={retryCloneInit}>重试初始化</button>
                      )}
                      <button type="button" className="ghost danger-text" onClick={deleteAgent} disabled={busy || loading}>解聘</button>
                    </>
                  )}
                </div>
              </header>

              <p className="muted ma-age-line ma-age-fixed">已运行 {fmtAge(selected.created_at)}</p>

              {!workflowBusy && initializing && <p className="thinking">正在继承同事记忆…</p>}
              {!workflowBusy && cloneInitBusy && <p className="thinking">正在为副本整理记忆，完成后可继续对话</p>}
              {!workflowBusy && compressing && <p className="thinking ma-compressing">正在压缩记忆…</p>}

              {!workflowBusy && Object.keys(invokeMap).length > 0 && (
                <div className="ma-invoke-dock">
                  {Object.values(invokeMap).map((inv) => (
                    <div key={inv.calleeId} className={`ma-invoke-chip ${inv.collapsed ? 'collapsed' : ''}`}>
                      <div className="ma-invoke-chip-head">
                        <strong>{inv.name}</strong>
                        <span className={`ma-status st-${statusClass(inv.status)}`}>{statusZh(inv.status, t)}</span>
                      </div>
                      {!inv.collapsed && (
                        <p className="ma-invoke-chip-body">{inv.message || inv.content?.slice(0, 80) || '执行中…'}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!workflowBusy && (
              <div className="chatbox ma-chatbox" ref={boxRef} onScroll={onChatScroll}>
                {sess.loadingMore && <p className="thinking">加载更早消息…</p>}
                {sess.hasMore && !sess.loadingMore && (
                  <button type="button" className="ma-load-more" onClick={loadOlder}>加载更早</button>
                )}
                {chatLog.length === 0 && !loading && (
                  <p className="empty-chat">给同事下达任务后，需授权的命令会在此确认</p>
                )}
                {chatLog.map((m, i) => (
                  <div key={`${selectedId}-${m.id || `i${i}`}`} className={`msg ${m.role} ${m.decision === 'deny' ? 'cmd-denied' : ''} ${m.role === 'assistant' ? 'ma-flat' : ''}`}>
                    <div className="msg-label">
                      <span>
                        {(m.role === 'assistant' || m.role === 'invoke_quote') && (
                          <JellyAvatar
                            className="ma-msg-jelly"
                            color={resolveJellyColor(selected)}
                            size={16}
                            state={
                              m.role === 'assistant' && loading && i === chatLog.length - 1
                                ? jellyStateFromPhase(sess.agentPhase, 'working')
                                : jellyStateFromAgent(selected)
                            }
                          />
                        )}
                        {m.role === 'user' ? '你'
                          : m.role === 'auto' ? '自动审核'
                            : m.role === 'system' ? '系统'
                            : m.role === 'status' ? '状态'
                            : m.role === 'command'
                              ? (m.decision === 'deny' ? '已拒绝命令' : '已执行命令')
                              : m.role === 'invoke_quote' ? `引用 · ${m.calleeName || '同事'}`
                                : m.role === 'invoke_divider' ? '调用记录'
                                  : selected.name}
                      </span>
                      {m.role === 'command' && m.decidedBy && (
                        <span className="cmd-by">{byLabel(m.decidedBy)}</span>
                      )}
                      {m.role === 'assistant' && (m.content || '').trim() && (
                        <CopyTextButton text={m.content} />
                      )}
                      {m.replySec > 0 && <span className="reply-sec">{fmtSec(m.replySec)}</span>}
                    </div>
                    {m.role === 'auto' ? (
                      <div className="auto-trace">{m.note || 'AI 已自动放行'} <code>{m.content}</code></div>
                    ) : m.role === 'command' ? (
                      <div className="ma-timeline-item ma-timeline-cmd">
                        <span className="ma-tl-mark" aria-hidden="true">·</span>
                        <div className="ma-tl-body">
                          <CmdBlock
                            content={m.content}
                            decision={m.decision}
                            risk={m.risk}
                            meaning={m.meaning}
                            note={m.note}
                          />
                        </div>
                      </div>
                    ) : m.role === 'system' ? (
                      <div className="ma-system-note">{m.content}</div>
                    ) : m.role === 'status' ? (
                      <div className="ma-status-snap">
                        <pre>{m.content}</pre>
                      </div>
                    ) : m.role === 'invoke_quote' ? (
                      <details className="ma-quote" open={false}>
                        <summary>{m.calleeName || '同事'} 的结果</summary>
                        <AgentMarkdown content={m.content || ''} agentId={selected.id} authHeaders={authHeaders} />
                      </details>
                    ) : m.role === 'invoke_divider' ? (
                      <div className="ma-divider-msg">{m.content}</div>
                    ) : m.role === 'assistant' ? (
                      <div className="ma-timeline-assistant">
                        <AgentMarkdown content={m.content || ''} agentId={selected.id} authHeaders={authHeaders} />
                        {(m.attachments || []).length > 0 && (
                          <ChatMessageImages attachments={m.attachments} onOpen={setLightboxSrc} />
                        )}
                      </div>
                    ) : (
                      <div className="msg-body">
                        {(m.attachments || []).length > 0 && (
                          <ChatMessageImages attachments={m.attachments} onOpen={setLightboxSrc} />
                        )}
                        {m.content ? (
                          <div dangerouslySetInnerHTML={{ __html: escapeHtml(m.content) }} />
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
                {permQueue[0] && (
                  <PermCard
                    p={permQueue[0]}
                    more={permQueue.length - 1}
                    busy={permBusy}
                    onDecide={decide}
                  />
                )}
                {loading && (
                  <RunStatus
                    interrupting={interrupting}
                    activity={sess.liveActivity}
                    runSec={liveRunSec(selected)}
                    taskTokens={sess.taskTokens || 0}
                    phase={sess.agentPhase}
                    jellyColor={resolveJellyColor(selected)}
                  />
                )}
              </div>
              )}

              {!chatLocked && (
              <div
                className="ma-composer"
                ref={composerDropRef}
                onDragOver={onComposerDragOver}
                onDrop={onComposerDrop}
              >
                <AgentRuntimeDetail
                  open={runtimeDetailOpen && !!runtimeForDetail}
                  runtime={runtimeForDetail}
                  agent={selected}
                  context={{
                    used: sess.contextUsed,
                    window: sess.contextWindow,
                    estimated: sess.contextEstimated,
                    source: sess.contextSource,
                  }}
                  parallelCount={Object.keys(invokeMap).length}
                  onClose={() => setRuntimeDetailOpen(false)}
                />
                <div className="ma-composer-shell">
                  <div className="ma-composer-tools" aria-label="任务工具">
                    <button
                      type="button"
                      className={`ma-composer-tool${taskPlanOn ? ' is-active' : ''}`}
                      data-tooltip="Task Plan"
                      aria-label={`${t('composer.taskPlan')} · ${taskPlanOn ? '已开启' : '已关闭'}`}
                      aria-pressed={taskPlanOn}
                      disabled={taskPlanSaving || loading}
                      onClick={() => void toggleTaskPlan(!taskPlanOn)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="7" cy="18" r="2" /><path d="M8 5h4a4 4 0 0 1 4 4v1M7 7v9M9 18h5a4 4 0 0 0 4-4v-2" />
                      </svg>
                      <span>Task Plan</span>
                    </button>
                    <button
                      type="button"
                      className={`ma-composer-tool${taskQueueOpen ? ' is-active' : ''}`}
                      data-tooltip="Task Queue"
                      aria-label="Task Queue · 任务队列"
                      aria-pressed={taskQueueOpen}
                      onClick={() => {
                        setRuntimeDetailOpen(false)
                        setTaskQueueOpen((value) => !value)
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                        <path d="M9 6h10M9 12h10M9 18h10" /><circle cx="5" cy="6" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="18" r="1" />
                      </svg>
                      <span>Task Queue</span>
                      {taskQueueBadge > 0 ? (
                        <em className="ma-composer-tool-badge">{taskQueueBadge > 9 ? '9+' : taskQueueBadge}</em>
                      ) : null}
                    </button>
                    {runtimeForDetail ? <button
                      type="button"
                      className={`ma-composer-tool${runtimeDetailOpen ? ' is-active' : ''}`}
                      data-tooltip="Runtime Detail"
                      aria-label="Agent Runtime Detail · 运行明细"
                      aria-pressed={runtimeDetailOpen}
                      onClick={() => {
                        setTaskQueueOpen(false)
                        setRuntimeDetailOpen((value) => !value)
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />
                      </svg>
                      <span>Runtime Detail</span>
                    </button> : null}
                  </div>
                  <div className="ma-composer-wrap">
                    <GroupChatOfferSheet
                      open={!!groupOffer}
                      agents={agents}
                      memberIds={groupOffer?.memberIds || []}
                      creating={groupCreating}
                      onCreate={resolveGroupOfferCreate}
                      onTimeout={resolveGroupOfferParallel}
                    />
                    <TaskQueueChoiceSheet
                      open={!!tqChoice}
                      busy={tqChoiceBusy}
                      hideEnqueue={!!tqChoice?.hideEnqueue}
                      onInterrupt={() => void onTqInterrupt()}
                      onEnqueue={() => void onTqEnqueue()}
                      onCancel={() => setTqChoice(null)}
                    />
                    {mentionOpen && mentionCandidates.length > 0 && (
                      <ul className="ma-mention-list">
                        {mentionCandidates.map((a, i) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              className={i === mentionIdx ? 'active' : ''}
                              onMouseDown={(e) => { e.preventDefault(); insertMention(a) }}
                            >
                              <EngineTagWithSkills engine={a.engine} skillCount={a.skill_count} />
                              {a.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <ChatAttachPreview
                      items={pendingImages}
                      onRemove={removePendingImage}
                      onOpen={setLightboxSrc}
                    />
                    <textarea
                      ref={composerRef}
                      className="ma-composer-input"
                      value={question}
                      onChange={onComposerChange}
                      onKeyDown={onKeyDown}
                      onPaste={onComposerPaste}
                      onInput={autosizeComposer}
                      rows={1}
                      placeholder={
                        initializing
                          ? t('composer.placeholderInit')
                          : (loading
                            ? t('composer.placeholderBusy')
                            : t('composer.placeholder'))
                      }
                      disabled={initializing || !!groupOffer}
                    />
                  </div>
                  <div className="ma-composer-bar">
                    <div className="ma-composer-bar-left">
                      <input
                        ref={composerFileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                          ingestComposerImages(e.target.files)
                          e.target.value = ''
                        }}
                      />
                      <button
                        type="button"
                        className="ma-composer-plus"
                        title={t('composer.addImage')}
                        aria-label={t('composer.addImage')}
                        disabled={initializing || !!groupOffer || attachBusy || pendingImages.length >= 6}
                        onClick={() => composerFileRef.current?.click()}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                      <ContextRing
                        used={sess.contextUsed || 0}
                        window={sess.contextWindow || 0}
                        estimated={sess.contextEstimated !== false}
                        source={sess.contextSource || ''}
                        updatedAt={sess.contextUpdatedAt || 0}
                        anomaly={sess.contextAnomaly || ''}
                      />
                      <span className="ma-composer-kbd">{t('composer.kbdSend')}</span>
                    </div>
                    <div className="ma-composer-actions">
                      {!loading ? (
                        <button
                          type="button"
                          className="primary ma-composer-send"
                          onClick={ask}
                          disabled={!!groupOffer || (!question.trim() && !pendingImages.length) || compressing || initializing || attachBusy}
                        >
                          {attachBusy ? t('composer.uploading') : t('composer.send')}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ma-composer-interrupt"
                            onClick={ask}
                            disabled={!!groupOffer || (!question.trim() && !pendingImages.length) || compressing || initializing || attachBusy}
                          >
                            {attachBusy ? t('composer.uploading') : (interrupting ? t('composer.interrupting') : t('composer.interrupt'))}
                          </button>
                          <button type="button" className="stop ma-composer-stop" onClick={stopRun} title={t('composer.stop')}>
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
                            <span>终止</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {cloneInitBusy && (
                <p className="muted ma-wf-busy-hint">
                  该同事正在为新复制的同事整理记忆，对话暂不可用；总结完成后将自动恢复。
                </p>
              )}
              {workflowBusy && (
                <p className="muted ma-wf-busy-hint">
                  该同事正在项目协作中执行任务，对话暂不可用；完成后将自动恢复对话窗口。
                  {occupancyLine(selected) ? `（${occupancyLine(selected)}）` : ''}
                </p>
              )}

              {taskPlanOn && (
              <div className="ma-progress-panel">
                <div className="ma-progress-head">
                  <strong>{t('composer.taskPlan')}</strong>
                  {activeTask ? (
                    <span className={`ma-status st-${statusClass(activeTask.status)}`}>
                      {planPhase === 'planning' ? t('composer.planning') : statusZh(activeTask.status, t)}
                    </span>
                  ) : (
                    <span className="muted">{t('composer.noActiveTask')}</span>
                  )}
                </div>
                {activeTask && (
                  <>
                    <div className="ma-progress-title">{activeTask.task_name || activeTask.task_id}</div>
                    <div className="agent-progress-bar">
                      <div style={{ width: `${activeProgress}%` }} />
                    </div>
                    <p className="muted ma-progress-msg">{activeTask.message || `${activeProgress}%`}</p>
                    {activeSteps.length > 0 && (
                      <ol className="ma-progress-steps">
                        {activeSteps.map((s, i) => {
                          const cls = stepClass(i)
                          return (
                            <li key={i} className={cls}>
                              {cls === 'failed' ? <span className="step-x">✕</span> : null}
                              {s}
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </>
                )}
              </div>
              )}
            </div>
          )}
          {sess.error && <p className="error ma-last-error">{shortErrorText(sess.error)}</p>}
          {selected?.last_error && !loading && (
            <p className="error ma-last-error" title={String(selected.last_error)}>
              上次错误: {shortErrorText(selected.last_error)}
            </p>
          )}
        </div>
      </div>

      <TalentMarket
        open={talentMarketOpen}
        authHeaders={authHeaders}
        onUnauthorized={onUnauthorized}
        onClose={() => setTalentMarketOpen(false)}
        onHired={(a) => {
          if (a?.id) loadAgents(a.id, { forceSelect: true })
          onAgentHired?.(a)
        }}
        onCustomHire={() => {
          setTalentMarketOpen(false)
          setNewPolicy(emptyPolicy())
          setNewJellyColor(assignJellyColor(String(Date.now())))
          setCreateOpen(true)
        }}
      />

      {createOpen && (
        <div className="modal-mask" onClick={() => !busy && setCreateOpen(false)}>
          <form className="modal-card ma-settings" onClick={(e) => e.stopPropagation()} onSubmit={createAgent}>
            <h2>自定义招聘</h2>
            <JellyColorPicker value={newJellyColor} onChange={setNewJellyColor} disabled={busy} />
            <label>名称<input value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} /></label>
            <label>
              引擎
              <select value={newEngine} onChange={(e) => setNewEngine(e.target.value)} disabled={busy}>
                {ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </label>
            <label>
              上下文窗口
              <select value={newContextWindow} onChange={(e) => setNewContextWindow(Number(e.target.value))} disabled={busy}>
                <option value={262144}>256K</option>
                <option value={524288}>512K</option>
                <option value={1000000}>1M</option>
              </select>
            </label>
            <label>规则描述<textarea rows={4} value={newRules} onChange={(e) => setNewRules(e.target.value)} disabled={busy} /></label>
            <AgentPolicyFields
              value={newPolicy}
              onChange={setNewPolicy}
              workspaces={workspaces}
              disabled={busy}
              authHeaders={authHeaders}
              onUnauthorized={onUnauthorized}
              onWorkspacesChange={setWorkspaces}
            />
            {createErr ? <pre className="error">{createErr}</pre> : null}
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setCreateOpen(false)}>取消</button>
              <button type="submit" disabled={busy}>{busy ? '招聘中…' : '确认招聘'}</button>
            </div>
          </form>
        </div>
      )}

      {copyOpen && selected && (
        <div className="modal-mask" onClick={() => !busy && setCopyOpen(false)}>
          <form className="modal-card ma-settings" onClick={(e) => e.stopPropagation()} onSubmit={copyAgent}>
            <h2>复制数字员工</h2>
            <div className="ma-avatar-edit">
              <JellyAvatar color={copyJellyColor} size={36} state="idle" />
              <p className="muted" style={{ margin: 0 }}>默认同源色，可改；不选则后端按新 id 分配。</p>
            </div>
            <JellyColorPicker value={copyJellyColor} onChange={setCopyJellyColor} disabled={busy} />
            <label>
              新名称
              <input value={copyName} onChange={(e) => setCopyName(e.target.value)} disabled={busy} autoFocus />
            </label>
            <p className="muted">将复制系统提示词、模型、权限与设置。新同事使用独立会话，并异步继承原员工的工作记忆。</p>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setCopyOpen(false)}>取消</button>
              <button type="submit" disabled={busy || !copyName.trim()}>{busy ? '复制中…' : '确认复制'}</button>
            </div>
          </form>
        </div>
      )}

      {folderCreateOpen && (
        <div className="modal-mask" onClick={() => !busy && setFolderCreateOpen(false)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={createFolder}>
            <h2>创建工作组</h2>
            <label>
              工作组名称
              <input
                value={folderCreateName}
                onChange={(e) => setFolderCreateName(e.target.value)}
                disabled={busy}
                placeholder="例如：研发组"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setFolderCreateOpen(false)}>取消</button>
              <button type="submit" disabled={busy || !folderCreateName.trim()}>{busy ? '创建中…' : '创建'}</button>
            </div>
          </form>
        </div>
      )}

      {folderEdit && (
        <div className="modal-mask" onClick={() => !busy && setFolderEdit(null)}>
          <form className="modal-card ma-settings" onClick={(e) => e.stopPropagation()} onSubmit={saveFolderEdit}>
            <h2>编辑工作组</h2>
            <label>
              工作组名称
              <input
                value={folderEditName}
                onChange={(e) => setFolderEditName(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
            <h3 className="ma-policy-title">工作组内数字员工</h3>
            <div className="ma-folder-agents">
              {agents.filter((a) => Number(a.folder_id) === Number(folderEdit.id)).length === 0 ? (
                <p className="ma-folder-empty">工作组还空着，从左侧拖入同事</p>
              ) : (
                agents
                  .filter((a) => Number(a.folder_id) === Number(folderEdit.id))
                  .map((a) => (
                    <div key={a.id} className="ma-folder-member">
                      <span className="ma-folder-member-name">{a.name}</span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => removeAgentFromFolder(a.id)}
                      >
                        移出
                      </button>
                    </div>
                  ))
              )}
            </div>
            <p className="muted">移出后同事回到「未入组」。</p>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setFolderEdit(null)}>取消</button>
              <button type="submit" disabled={busy || !folderEditName.trim()}>{busy ? '保存中…' : '保存名称'}</button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && selected && (
        <div className="modal-mask" onClick={() => {
          if (busy) return
          setSettingsOpen(false)
          loadAgents(selected.id)
        }}>
          <div
            className="modal-card ma-settings ma-settings-wide ma-settings-modern"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ma-settings-head">
              <div>
                <h2>员工设置</h2>
                <p className="ma-settings-sub">{selected.name} · 管理数字员工的基础信息、技能与记忆</p>
              </div>
              <button
                type="button"
                className="ma-settings-close"
                disabled={busy}
                aria-label="关闭"
                onClick={() => { setSettingsOpen(false); loadAgents(selected.id) }}
              >
                ×
              </button>
            </header>
            <div className="ma-settings-tabs" role="tablist">
              <button type="button" className={settingsTab === 'basic' ? 'active' : ''} onClick={() => setSettingsTab('basic')}>基本</button>
              <button type="button" className={settingsTab === 'approval' ? 'active' : ''} onClick={() => setSettingsTab('approval')}>命令审批</button>
              <button type="button" className={settingsTab === 'skills' ? 'active' : ''} onClick={() => setSettingsTab('skills')}>技能</button>
              <button
                type="button"
                className={settingsTab === 'legacy' ? 'active' : ''}
                onClick={() => { setSettingsTab('legacy'); loadLegacyMounts(selected.id) }}
              >
                继承记忆
              </button>
            </div>
            {settingsTab === 'basic' ? (
              <form className="ma-settings-form" onSubmit={(e) => { e.preventDefault(); saveRules() }}>
                <section className="ma-settings-section">
                  <div className="ma-avatar-edit">
                    <JellyAvatar color={jellyColorDraft} size={56} state="idle" />
                    <div className="ma-avatar-actions">
                      <JellyColorPicker value={jellyColorDraft} onChange={setJellyColorDraft} disabled={busy} label="水母颜色" />
                    </div>
                  </div>
                  <div className="ma-settings-grid">
                    <label>
                      名称
                      <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} disabled={busy} />
                    </label>
                    <label>
                      上下文窗口
                      <select value={contextWindowDraft} onChange={(e) => setContextWindowDraft(Number(e.target.value))} disabled={busy}>
                        <option value={262144}>256K</option>
                        <option value={524288}>512K</option>
                        <option value={1000000}>1M</option>
                      </select>
                    </label>
                  </div>
                </section>
                <section className="ma-settings-section">
                  <div className="ma-settings-section-label">
                    <span>系统提示词</span>
                  </div>
                  <div className="ma-settings-prompt">
                    <textarea
                      rows={9}
                      value={rulesDraft}
                      onChange={(e) => setRulesDraft(e.target.value)}
                      disabled={busy}
                      placeholder="角色、边界与协作方式…"
                      spellCheck={false}
                    />
                  </div>
                </section>
                <AgentPolicyFields
                  value={policyDraft}
                  onChange={setPolicyDraft}
                  workspaces={workspaces}
                  disabled={busy}
                  authHeaders={authHeaders}
                  onUnauthorized={onUnauthorized}
                  onWorkspacesChange={setWorkspaces}
                />
                <div className="modal-actions">
                  <button type="button" disabled={busy} onClick={() => setSettingsOpen(false)}>取消</button>
                  <button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
                </div>
              </form>
            ) : settingsTab === 'approval' ? (
              <div className="ma-approval-settings-panel">
                <CapsuleToggle
                  label="命令全部审批通过"
                  hint="自动通过；记录保留 7 天。Hard Deny 仍不可绕过"
                  checked={approveAllOn}
                  disabled={approveAllSaving || workflowBusy}
                  onChange={toggleApproveAll}
                />
                <CapsuleToggle
                  label="自动审核"
                  hint={
                    jevReady
                      ? '本地 JEV 审核非常规命令'
                      : `需先开启 JEV：${jevHint || '设置 · JEV'}`
                  }
                  checked={autoOn}
                  disabled={autoSaving || approveAllOn || workflowBusy || !jevReady}
                  onChange={toggleAuto}
                />
                <div className="modal-actions">
                  <button type="button" disabled={autoSaving || approveAllSaving} onClick={() => setSettingsOpen(false)}>关闭</button>
                </div>
              </div>
            ) : settingsTab === 'skills' ? (
              <>
                <AgentSkillsPanel
                  agentId={selected.id}
                  authHeaders={authHeaders}
                  onUnauthorized={onUnauthorized}
                  activeTab={skillsSubTab}
                  onTabChange={setSkillsSubTab}
                  disabled={busy}
                />
                <div className="modal-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSettingsOpen(false)
                      loadAgents(selected.id)
                    }}
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <div className="lm-mounts-panel">
                <p className="ma-settings-tip">最多 5 本；正文可在「基本」编辑。</p>
                {legacyMounts.length === 0 ? (
                  <p className="empty">尚未继承。可在「数字员工记忆」书架认领。</p>
                ) : (
                  <ul className="lm-mount-list">
                    {legacyMounts.map((m) => (
                      <li key={m.id} className="lm-mount-item">
                        <JellyAvatar
                          className="lm-mount-avatar"
                          color={resolveJellyColor({ id: m.source_agent_id || m.legacy_memory_id || m.id })}
                          size={28}
                          state="idle"
                        />
                        <div>
                          <strong>{m.source_agent_name}</strong>
                          <span>{m.source_job_title || '数字员工'}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="modal-actions">
                  <button type="button" className="ghost" disabled={busy} onClick={() => loadLegacyMounts(selected.id)}>刷新</button>
                  <button type="button" disabled={busy} onClick={() => setSettingsOpen(false)}>关闭</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <DismissAgentModal
        open={!!dismissTarget}
        agents={dismissTarget ? [{ id: dismissTarget.id, name: dismissTarget.name }] : []}
        authHeaders={authHeaders}
        onUnauthorized={onUnauthorized}
        onClose={() => setDismissTarget(null)}
        onDone={(ids) => {
          ids.forEach((id) => clearAgentSession(id))
          loadAgents(0)
        }}
      />

      <ChatLightbox src={lightboxSrc} onClose={() => setLightboxSrc('')} />
    </section>
  )
}

function policyFromAgent(a) {
  if (!a) return emptyPolicy()
  const cron = a.schedule_cron || ''
  const preset = SCHEDULE_PRESETS.find((p) => p.cron && p.cron === cron)?.id || ''
  const ws = a.workspace_path || ''
  return {
    allow_write: a.allow_write !== false,
    allow_network: a.allow_network !== false,
    allow_rm: !!a.allow_rm,
    workspace_bound: !!ws,
    workspace_path: ws,
    schedule_enabled: !!a.schedule_enabled,
    schedule_cron: cron,
    schedule_label: a.schedule_label || '',
    schedule_preset: preset,
  }
}

/** 权限 / 工作区 / 定时表单块 */
function AgentPolicyFields({ value, onChange, workspaces, disabled, authHeaders, onUnauthorized, onWorkspacesChange }) {
  const v = value || emptyPolicy()
  const [pickingDir, setPickingDir] = useState(false)
  const [pickErr, setPickErr] = useState('')
  function patch(p) {
    onChange({ ...v, ...p })
  }
  /** 调用本机 macOS 原生「选择文件夹」面板 */
  async function pickDirectoryNative() {
    if (disabled || pickingDir || !authHeaders) return
    setPickingDir(true)
    setPickErr('')
    try {
      const res = await fetch(`${API}/admin/pick-directory`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: '选择数字员工工作区目录' }),
      })
      if (res.status === 401) { onUnauthorized?.(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPickErr(d.error || '无法打开系统选目录面板，请改用下方手动输入')
        return
      }
      if (d.cancelled) return
      const path = String(d.path || '').trim()
      if (!path) {
        setPickErr('未选择目录')
        return
      }
      patch({ workspace_path: path })
      // 刷新授权列表，便于下拉里看到刚选的路径（若已登记）
      try {
        const wr = await fetch(`${API}/workspaces`)
        const wd = await wr.json().catch(() => ({}))
        if (Array.isArray(wd.items)) onWorkspacesChange?.(wd.items)
      } catch { /* ignore */ }
    } catch (e) {
      setPickErr(String(e.message || e) || '选目录失败')
    } finally {
      setPickingDir(false)
    }
  }
  return (
    <div className="ma-policy">
      <section className="ma-settings-section">
        <h3 className="ma-policy-title">权限</h3>
        <CapsuleToggle label="允许写入文件" checked={!!v.allow_write} disabled={disabled} onChange={(c) => patch({ allow_write: c })} />
        <CapsuleToggle label="允许联网搜索" checked={!!v.allow_network} disabled={disabled} onChange={(c) => patch({ allow_network: c })} />
        <CapsuleToggle label="允许执行 rm" checked={!!v.allow_rm} disabled={disabled} onChange={(c) => patch({ allow_rm: c })} />
        <p className="ma-settings-tip">浏览器请到「技能 → 浏览器操作」安装。</p>
      </section>

      <section className="ma-settings-section">
        <h3 className="ma-policy-title">工作区</h3>
        <CapsuleToggle
          label="限制工作区"
          hint="关闭=默认可全盘读写；开启=仅指定目录。换目录保留对话与引擎会话，并尽量迁移 projects/"
          checked={!!v.workspace_bound}
          disabled={disabled}
          onChange={(c) => patch({ workspace_bound: c, workspace_path: c ? v.workspace_path : '' })}
        />
        {v.workspace_bound && (
          <div className="ma-policy-sub">
            <div className="ma-ws-pick-row">
              <button
                type="button"
                className="ghost"
                disabled={disabled || pickingDir || !authHeaders}
                onClick={pickDirectoryNative}
                title="打开 macOS 系统文件夹选择面板"
              >
                {pickingDir ? '选择中…' : '浏览选择目录…'}
              </button>
              <span className="ma-ws-pick-hint">Mac 系统弹窗</span>
            </div>
            {pickErr ? <p className="ma-ws-pick-err">{pickErr}</p> : null}
            <label>
              已授权目录
              <select
                value={workspaces.some((w) => w.path === v.workspace_path) ? v.workspace_path : ''}
                disabled={disabled}
                onChange={(e) => patch({ workspace_path: e.target.value })}
              >
                <option value="">请选择…</option>
                {(workspaces || []).map((w) => (
                  <option key={w.id || w.path} value={w.path}>{w.name || w.path}</option>
                ))}
              </select>
            </label>
            <label>
              绝对路径
              <input
                value={v.workspace_path || ''}
                disabled={disabled}
                placeholder="/Users/.../project"
                onChange={(e) => patch({ workspace_path: e.target.value })}
              />
            </label>
          </div>
        )}
      </section>

      <section className="ma-settings-section">
        <CapsuleToggle
          label="开启定时执行"
          checked={!!v.schedule_enabled}
          disabled={disabled}
          onChange={(c) => patch({ schedule_enabled: c })}
        />
        {v.schedule_enabled && (
          <div className="ma-policy-sub ma-schedule">
            <label>
              常用计划
              <select
                value={v.schedule_preset || ''}
                disabled={disabled}
                onChange={(e) => {
                  const id = e.target.value
                  const p = SCHEDULE_PRESETS.find((x) => x.id === id)
                  patch({
                    schedule_preset: id,
                    schedule_cron: p?.cron || v.schedule_cron,
                    schedule_label: p?.label && id ? p.label : v.schedule_label,
                  })
                }}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.id || 'custom'} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              Cron（分 时 日 月 周）
              <input
                value={v.schedule_cron || ''}
                disabled={disabled}
                placeholder="0 9 * * 1-5"
                onChange={(e) => patch({ schedule_cron: e.target.value, schedule_preset: '' })}
              />
            </label>
            <label>
              计划名称
              <input
                value={v.schedule_label || ''}
                disabled={disabled}
                placeholder="例行巡检"
                onChange={(e) => patch({ schedule_label: e.target.value })}
              />
            </label>
          </div>
        )}
      </section>
    </div>
  )
}

function CapsuleToggle({ label, checked, disabled, onChange, hint }) {
  return (
    <div className={`ma-capsule-row ${disabled ? 'disabled' : ''}`}>
      <div className="ma-capsule-text">
        <span className="ma-capsule-label">{label}</span>
        {hint && <p className="ma-capsule-hint">{hint}</p>}
      </div>
      <label className={`auto-switch ma-capsule ${disabled ? 'busy' : ''}`}>
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider" />
      </label>
    </div>
  )
}

/** 全局授权浮层:面板隐藏/已退到对话页时仍可裁决 */
export function ManagedAgentPermOverlay({ authHeaders, onUnauthorized }) {
  const [, setVer] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribeAgentSessions(() => setVer((v) => v + 1)), [])
  useEffect(() => {
    const t = setInterval(() => setVer((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const pending = allPendingPerms()
  if (pending.length === 0) return null
  const p = pending[0]

  async function decide(behavior) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/permissions/decide`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ request_id: p.request_id, behavior }),
      })
      if (res.status === 401) onUnauthorized?.()
    } finally {
      patchAgentSession(p.agentId, {
        permQueue: (getAgentSession(p.agentId).permQueue || []).filter((x) => x.request_id !== p.request_id),
      })
      setBusy(false)
    }
  }

  return (
    <div className="ma-perm-overlay">
      <div className="ma-perm-overlay-card">
        <div className="perm-title">🔐 数字员工 #{p.agentId} 申请授权 · 剩余 {remainSec(p)}s</div>
        <PermCard p={p} more={pending.length - 1} busy={busy} onDecide={(_, b) => decide(b)} />
      </div>
    </div>
  )
}

function PermCard({ p, more, busy, onDecide }) {
  const trust = p?.tool_name === 'WorkspaceTrust'
  return (
    <div className="perm-card">
      <div className="perm-title">
        {trust ? '需要确认是否信任该工作区' : '🔐 申请使用工具,需要你授权'}
        <span className={`perm-count ${remainSec(p) <= 10 ? 'urgent' : ''}`}>剩余 {remainSec(p)}s</span>
      </div>
      {p.note && <div className="perm-note">{p.note}</div>}
      <div className="perm-tool">{p.tool_name}</div>
      <CmdBlock content={p.summary} risk={p.risk} meaning={p.meaning} decision="ask" startExpanded />
      {more > 0 && <div className="perm-more">+{more} 条排队中</div>}
      <div className="perm-actions">
        <button type="button" className="deny" onClick={() => onDecide(p.request_id, 'deny')}>拒绝</button>
        {trust ? (
          <button type="button" className="allow" onClick={() => onDecide(p.request_id, 'allow')} disabled={busy}>信任并继续</button>
        ) : (
          <>
            <button type="button" className="allow" onClick={() => onDecide(p.request_id, 'allow')} disabled={busy}>本次允许</button>
            <button type="button" className="allow" onClick={() => onDecide(p.request_id, 'allow_session')} disabled={busy}>本次会话允许</button>
          </>
        )}
      </div>
      <div className="perm-hint">{trust
        ? '同意后才会带 --trust 启动 Cursor Agent。拒绝或超时都不会执行。'
        : 'Hard Deny 不可绕过。会话允许仅匹配规范化命令签名。超时自动拒绝。'}</div>
    </div>
  )
}

function commandPreview(content, max = 72) {
  const oneLine = String(content || '').replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/** 命令框：对话时间线默认折叠；审批卡保持展开，避免隐藏待确认内容。 */
function CmdBlock({ content, risk, meaning, decision, note, startExpanded = false }) {
  const r = risk || (decision === 'deny' ? 'high' : 'mid')
  const riskText = ({ low: '无害', mid: '需注意', high: '高风险' })[r] || '需注意'
  const [open, setOpen] = useState(startExpanded)
  if (!open) {
    return (
      <button
        type="button"
        className={`cmd-block cmd-block-collapsed risk-${r} ${decision === 'deny' ? 'denied' : ''}`}
        onClick={() => setOpen(true)}
        aria-expanded={false}
        title="点击展开命令"
      >
        <span className="cmd-fold-tri" aria-hidden="true">▶</span>
        <code className="cmd-preview">{commandPreview(content)}</code>
        <span className="cmd-risk-dot">{riskText}</span>
      </button>
    )
  }
  return (
    <div className={`cmd-block risk-${r} ${decision === 'deny' ? 'denied' : ''}`}>
      <button type="button" className="cmd-fold-head" onClick={() => setOpen(false)} aria-expanded={true} title="点击折叠">
        <span className="cmd-fold-tri" aria-hidden="true">▼</span>
        <span className="cmd-fold-hint">命令</span>
      </button>
      <div className="cmd-block-main">
        <code>{content}</code>
        <CopyTextButton text={content} className="cmd-copy" />
      </div>
      {note ? <pre className="ma-tl-out">{note}</pre> : null}
      {(meaning || risk) && (
        <div className="cmd-meaning-bar">
          <span className="cmd-risk-dot">{riskText}</span>
          <span>{meaning || `风险等级：${riskText}`}</span>
        </div>
      )}
    </div>
  )
}

function dedupPerm(list) {
  const seen = new Set()
  return list.filter((p) => (seen.has(p.request_id) ? false : (seen.add(p.request_id), true)))
}

function remainSec(p) {
  if (!p?.deadline) return 999
  const ms = new Date(p.deadline).getTime()
  if (!Number.isFinite(ms)) return 999
  return Math.max(0, Math.floor((ms - Date.now()) / 1000))
}

function byLabel(by) {
  return ({ user: '人工审批', ai: 'AI 审批', system: '系统自动', timeout: '超时拒绝', disconnect: '断连拒绝', codex: 'Codex' })[by] || by
}

/** 一键复制纯文本 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || '')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text || ''
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** 复制按钮：成功后短暂显示「已复制」 */
function CopyTextButton({ text, className = 'ma-copy-btn' }) {
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    await copyText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button
      type="button"
      className={`${className}${copied ? ' is-copied' : ''}`}
      onClick={onCopy}
      title={copied ? '已复制' : '复制回复'}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

/** 运行态：跳动水母 + thinking 文案 + token + 工具活动条 */
function RunStatus({ interrupting, activity, runSec, taskTokens, phase = '', jellyColor = 'blue' }) {
  const [phraseIdx, setPhraseIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length)
    }, 2400)
    return () => clearInterval(t)
  }, [])
  const phrase = interrupting ? 'interrupting' : THINKING_PHRASES[phraseIdx]
  return (
    <div className="ma-run-status">
      <div className="ma-thinking" aria-live="polite">
        <JellyAvatar
          className="ma-thinking-jelly"
          color={jellyColor}
          size={18}
          state={jellyStateFromPhase(phase, 'working')}
        />
        <span className="ma-thinking-text">{phrase}</span>
        {runSec > 0 && <span className="ma-thinking-sec">{fmtSec(runSec)}</span>}
        {taskTokens > 0 && <span className="ma-thinking-tokens">{fmtToken(taskTokens)} tokens</span>}
      </div>
      {activity?.summary && (
        <div className="ma-activity" title={activity.tool || ''}>
          <span className="ma-activity-dot" />
          <span className="ma-activity-text">{activity.summary}</span>
        </div>
      )}
    </div>
  )
}

/** 上下文占比圆环：探测不到则整组件隐藏（不展示 — / !） */
function ContextRing({ used, window: win, estimated = true, source = '', updatedAt = 0, anomaly = '' }) {
  const src = String(source || '').trim().toLowerCase()
  const known = win > 0 && src !== 'unavailable' && (src !== '' || used > 0)
  if (!known) return null

  const size = 32
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const rawPct = used / win
  const over = rawPct > 1 || !!anomaly
  // 环长始终封顶；超窗数字封顶 100，避免叹号/破环
  const ringPct = Math.min(1, Math.max(0, rawPct))
  const dash = c * ringPct
  const labelPct = Math.min(100, Math.round(ringPct * 100))
  const sourceLabel = src === 'codex_session'
    ? 'Codex Session 快照'
    : (src === 'probe' ? 'Claude /context' : source)
  const timeLabel = updatedAt > 0 ? `\n更新时间：${new Date(updatedAt * 1000).toLocaleString()}` : ''
  const overHint = over ? `\n原始占比 ${Math.round(rawPct * 100)}%（环内已按窗口封顶）` : ''
  const title = `${estimated ? '约 ' : ''}${labelPct}%${overHint}${sourceLabel ? `\n来源：${sourceLabel}` : ''}${timeLabel}${anomaly ? `\n异常：${anomaly}` : ''}`
  const tone = ringPct > 0.85 ? 'hot' : ringPct > 0.6 ? 'warm' : 'ok'
  return (
    <div
      className={`ma-ctx-ring tone-${tone}${estimated ? ' is-estimated' : ''}${over ? ' is-anomaly' : ''}`}
      title={title}
      aria-label={title}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#3a3d45" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone === 'hot' ? '#ee7676' : tone === 'warm' ? '#e5b75a' : '#8eb4e8'}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className={`ma-ctx-ring-pct${labelPct >= 100 ? ' is-full' : ''}`}>
        {labelPct}<small>%</small>
      </span>
    </div>
  )
}

function countFolderBusy(list) {
  let direct = 0
  let wf = 0
  for (const a of list || []) {
    if (isWorkflowBusy(a)) wf += 1
    else if (getAgentSession(a.id).loading || a.status === 'running') direct += 1
  }
  return { direct, wf }
}

/** 未读完成时间毫秒；越早完成排序越靠后（倒序用） */
function unreadAtMs(a) {
  const raw = a?.task_unread_at
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? Math.floor(raw * 1000) : Math.floor(raw)
  }
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) {
    return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n)
  }
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : 0
}

/** 是否「忙」（与移动端 agentBusy 对齐，并含本地 loading/compressing） */
function isAgentBusy(a) {
  const local = getAgentSession(a?.id)
  if (local?.loading || local?.compressing) return true
  const s = String(a?.status || 'idle').toLowerCase()
  return (
    s === 'running' ||
    s === 'busy' ||
    s === '插话中' ||
    s === 'initializing' ||
    s === 'compressing' ||
    s === 'waiting'
  )
}

function fmtToken(n) {
  n = Number(n) || 0
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtSec(sec) {
  sec = Math.max(0, Math.round(sec || 0))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return `${m}m${r ? `${r}s` : ''}`
}

function fmtAge(ts) {
  if (!ts) return '-'
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 60) return `${Math.max(0, sec)}秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}小时`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}天${rh}小时` : `${d}天`
}
