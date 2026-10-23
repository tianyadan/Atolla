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
