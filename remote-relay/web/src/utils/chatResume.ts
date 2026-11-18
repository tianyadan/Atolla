const STORAGE_KEY = 'relay_chat_resume:v1'

export type ChatResumeTarget = {
  instanceId: string
  agentId: string
  conversationId?: string
  updatedAt: number
}
type ChatResumeState = {
  version: 1
  lastInstanceId: string
  instances: Record<string, ChatResumeTarget>
}

function emptyState(): ChatResumeState {
  return { version: 1, lastInstanceId: '', instances: {} }
}

function readState(): ChatResumeState {
  if (typeof localStorage === 'undefined') return emptyState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<ChatResumeState>
    if (parsed.version !== 1 || !parsed.instances || typeof parsed.instances !== 'object') {
      return emptyState()
    }
    return {
      version: 1,
      lastInstanceId: String(parsed.lastInstanceId || ''),
      instances: parsed.instances as Record<string, ChatResumeTarget>,
    }
  } catch {
    return emptyState()
  }
}

function writeState(state: ChatResumeState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode / quota: 会话仍可正常使用，仅不做下次恢复 */
  }
}

/** 记录每个实例最近使用的数字人，实例间严格隔离，禁止复用其它实例会话。 */
export function rememberChatSelection(
  instanceId: string,
  agentId: string,
  conversationId?: string | number | null,
): void {
  const iid = instanceId.trim()
  const aid = agentId.trim()
  if (!iid || !aid) return
  const state = readState()
  const cid = conversationId == null ? '' : String(conversationId).trim()
  state.lastInstanceId = iid
  state.instances[iid] = {
    instanceId: iid,
    agentId: aid,
    ...(cid ? { conversationId: cid } : {}),
    updatedAt: Date.now(),
  }
  writeState(state)
}

/** 读取某实例最近对话；只返回该实例命名空间下的数据。 */
export function loadInstanceChatSelection(instanceId: string): ChatResumeTarget | null {
  const iid = instanceId.trim()
  if (!iid) return null
  const target = readState().instances[iid]
  if (!target || target.instanceId !== iid || !target.agentId) return null
  return target
}

/** 读取整个 App 最近一次对话。 */
export function loadLastChatSelection(): ChatResumeTarget | null {
  const state = readState()
  if (!state.lastInstanceId) return null
  return loadInstanceChatSelection(state.lastInstanceId)
}

export function chatRoute(target: Pick<ChatResumeTarget, 'instanceId' | 'agentId'>): string {
  return `/instances/${encodeURIComponent(target.instanceId)}/agents/${encodeURIComponent(target.agentId)}/chat`
}
