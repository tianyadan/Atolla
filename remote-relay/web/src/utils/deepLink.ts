export type AgentDeepLinkTarget = {
  kind: 'agent'
  instanceId: string
  agentId: string
}

export type ApprovalDeepLinkTarget = {
  kind: 'approval'
  instanceId: string
  agentId: string
  requestId: string
}

export type AtollaDeepLinkTarget = AgentDeepLinkTarget | ApprovalDeepLinkTarget

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const PENDING_KEY = 'atolla.pendingDeepLink'

function decodeSegment(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const value = decodeURIComponent(raw).trim()
    return value || null
  } catch {
    return null
  }
}

export function parseAtollaDeepLink(url: string): AtollaDeepLinkTarget | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'atolla:') return null
    const kind = parsed.hostname
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (kind === 'agent' && parts.length === 3 && parts[2] === 'chat') {
      const instanceId = decodeSegment(parts[0])
      const agentId = decodeSegment(parts[1])
      return instanceId && agentId ? { kind: 'agent', instanceId, agentId } : null
    }
    if (kind === 'approval' && parts.length === 3) {
      const instanceId = decodeSegment(parts[0])
      const agentId = decodeSegment(parts[1])
      const requestId = decodeSegment(parts[2])
      return instanceId && agentId && requestId
        ? { kind: 'approval', instanceId, agentId, requestId }
        : null
    }
    return null
  } catch {
    return null
  }
}

export function deepLinkTargetPath(target: AtollaDeepLinkTarget): string {
  const base = `/instances/${encodeURIComponent(target.instanceId)}/agents/${encodeURIComponent(target.agentId)}/chat`
  return target.kind === 'approval'
    ? `${base}?approval_request_id=${encodeURIComponent(target.requestId)}`
    : base
}

/** 对话页左上角返回目标：实例下的数字人列表 */
export function deepLinkAgentsPath(target: Pick<AtollaDeepLinkTarget, 'instanceId'>): string {
  return `/instances/${encodeURIComponent(target.instanceId)}/agents`
}

/** 当前路由是否已是该深链目标（避免重复 navigate 把返回栈打坏） */
export function isDeepLinkPathActive(
  target: AtollaDeepLinkTarget,
  pathname: string,
  search = '',
): boolean {
  const want = deepLinkTargetPath(target)
  const [wantPath, wantQuery = ''] = want.split('?')
  if (pathname !== wantPath) return false
  if (!wantQuery) return true
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const wantParams = new URLSearchParams(wantQuery)
  for (const [key, value] of wantParams.entries()) {
    if (params.get(key) !== value) return false
  }
  return true
}

type NavigateFn = {
  (to: string, options?: { replace?: boolean }): void
}

/**
 * 打开对话深链：先落到数字人列表再 push 对话，保证 ← / 系统返回有稳定上一页。
 * 已在目标页则 no-op。
 */
export function navigateToDeepLinkChat(
  navigate: NavigateFn,
  target: AtollaDeepLinkTarget,
  current: { pathname: string; search: string },
): void {
  if (isDeepLinkPathActive(target, current.pathname, current.search)) {
    clearPendingDeepLink()
    return
  }
  clearPendingDeepLink()
  navigate(deepLinkAgentsPath(target), { replace: true })
  navigate(deepLinkTargetPath(target))
}

function defaultStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function savePendingDeepLink(
  target: AtollaDeepLinkTarget,
  storage: StorageLike | null = defaultStorage(),
): void {
  storage?.setItem(PENDING_KEY, JSON.stringify(target))
}

export function loadPendingDeepLink(
  storage: StorageLike | null = defaultStorage(),
): AtollaDeepLinkTarget | null {
  const raw = storage?.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AtollaDeepLinkTarget>
    if (value.kind === 'agent' && typeof value.instanceId === 'string' && typeof value.agentId === 'string') {
      return { kind: value.kind, instanceId: value.instanceId, agentId: value.agentId }
    }
    if (
      value.kind === 'approval' &&
      typeof value.instanceId === 'string' &&
      typeof value.agentId === 'string' &&
      typeof value.requestId === 'string'
    ) {
      return {
        kind: value.kind,
        instanceId: value.instanceId,
        agentId: value.agentId,
        requestId: value.requestId,
      }
    }
  } catch {
    // 损坏的持久化目标按无目标处理。
  }
  return null
}

export function clearPendingDeepLink(storage: StorageLike | null = defaultStorage()): void {
  storage?.removeItem(PENDING_KEY)
}
