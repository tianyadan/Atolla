import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PublicMirrorAgent } from './api'
import {
  buildIslandEvents,
  islandAgentsListDeepLink,
  islandEventDeepLink,
  selectIslandPresentation,
  type IslandPresentation,
} from './islandEvents'
import { agentBusy } from './utils/agentStatus'

export type NativeIslandItem = {
  id: string
  kind: string
  agentName: string
  department: string
  occurredAt: number
  /** unix 秒；审批截止，0 表示未知 */
  expiresAt: number
  durationMs: number
  summary: string
  workStatus: string
  deepLink: string
  jellyColor: string
  progress: number
  planPhase: string
  planStepTitle: string
  planCurrent: number
  planTotal: number
}

/** 与原生 AtollaIsland 插件对齐 */
export interface AtollaIslandPlugin {
  syncState(options: {
    activeKind: string
    count: number
    presentation: string
    moreDeepLink: string
    items: NativeIslandItem[]
  }): Promise<{ ok: boolean; started?: boolean; updated?: boolean }>
  isAvailable(): Promise<{ available: boolean; reason?: string }>
  endAll(): Promise<{ ok: boolean }>
}

const AtollaIsland = registerPlugin<AtollaIslandPlugin>('AtollaIsland')

let lastKey = ''
let lastError = ''

/** 最近一次上岛错误（调试） */
export function getIslandLastError(): string {
  return lastError
}

function toNativeItems(presentation: IslandPresentation): NativeIslandItem[] {
  return presentation.items.slice(0, 5).map((event) => {
    const plan = event.taskPlan
    return {
      id: event.id,
      kind: event.type,
      agentName: event.agentName,
      department: event.department,
      occurredAt: event.occurredAt > 0 ? event.occurredAt / 1000 : 0,
      expiresAt: event.expiresAt && event.expiresAt > 0 ? event.expiresAt / 1000 : 0,
      durationMs: event.durationMs ?? -1,
      summary: event.summary ?? '',
      workStatus: event.workStatus ?? event.summary ?? '',
      deepLink: islandEventDeepLink(event),
      jellyColor: event.jellyColor ?? 'blue',
      progress: plan?.progress ?? 0,
      planPhase: plan?.phase ?? '',
      planStepTitle: plan?.message || plan?.taskName || '',
      planCurrent: plan ? plan.currentStep + 1 : 0,
      planTotal: plan?.totalCount ?? 0,
    }
  })
}

/**
 * 对话页乐观上岛：镜像尚未标忙时，先把当前数字人推上岛。
 */
export async function syncIslandOptimisticAgent(
  agent: PublicMirrorAgent | null | undefined,
  opts?: { forceBusy?: boolean; instanceId?: string },
): Promise<void> {
  if (!agent) return
  const row: PublicMirrorAgent =
    opts?.forceBusy && !agentBusy(agent.status)
      ? { ...agent, status: 'running' }
      : agent
  await syncIslandFromAgents([row], opts?.instanceId ?? '')
}

/** 兼容原调用方的运行态同步；统一轮询接入后由 syncIslandPresentation 驱动。 */
export async function syncIslandFromAgents(
  agents: PublicMirrorAgent[],
  instanceId: string = '',
): Promise<void> {
  const events = buildIslandEvents(instanceId, agents, [])
  await syncIslandPresentation(selectIslandPresentation(events), instanceId)
}

/** 根据优先级聚合结果驱动一个原生 Live Activity。 */
export async function syncIslandPresentation(
  presentation: IslandPresentation,
  instanceId: string = '',
): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return

  const items = toNativeItems(presentation)
  const moreDeepLink = instanceId ? islandAgentsListDeepLink(instanceId) : ''
  const fullKey = JSON.stringify({
    activeKind: presentation.activeKind,
    count: presentation.count,
    presentation: presentation.presentation,
    moreDeepLink,
    items,
  })
  if (fullKey === lastKey) return

  try {
    const avail = await AtollaIsland.isAvailable()
    if (!avail.available) {
      lastError = avail.reason || 'Live Activity 未开启'
      console.warn('[AtollaIsland]', lastError)
      return
    }
    if (!presentation.activeKind || presentation.count === 0 || items.length === 0) {
      await AtollaIsland.endAll()
      lastKey = fullKey
      lastError = ''
      return
    }
    const res = await AtollaIsland.syncState({
      activeKind: presentation.activeKind,
      count: presentation.count,
      presentation: presentation.presentation,
      moreDeepLink,
      items,
    })
    lastKey = fullKey
    lastError = ''
    console.info('[AtollaIsland] sync ok', {
      count: presentation.count,
      presentation: presentation.presentation,
      res,
    })
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.warn('[AtollaIsland] sync failed', lastError)
  }
}

/** 强制下次重新同步 */
export function resetIslandSyncKey(): void {
  lastKey = ''
  lastError = ''
}
