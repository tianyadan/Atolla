import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PublicMirrorAgent } from './api'
import { resolveMirrorJellyColor } from './jelly/jellyColor'
import {
  agentBusy,
  agentRunStartedAt,
  agentStatusLabel,
  listBusyAgents,
} from './utils/agentStatus'

/** 岛上单个数字人摘要 */
export type IslandBusyAgent = {
  name: string
  jellyColor: string
  statusLabel: string
  runStartedAt: number
}

/** 与原生 AtollaIsland 插件对齐 */
export interface AtollaIslandPlugin {
  syncBusy(options: {
    count: number
    agents: IslandBusyAgent[]
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

/** 展示用忙碌状态文案（比「忙」更清晰） */
function islandStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').toLowerCase()
  if (s === 'waiting') return '等待中'
  if (s === 'compressing') return '压缩中'
  if (s === 'initializing') return '初始化'
  if (s === '插话中') return '插话中'
  if (agentStatusLabel(status) === '忙') return '运行中'
  return agentStatusLabel(status)
}

/** 把 mirror agents 编成岛上 slices（最多 5） */
function toIslandAgents(agents: PublicMirrorAgent[]): IslandBusyAgent[] {
  return listBusyAgents(agents)
    .slice(0, 5)
    .map((a) => ({
      name: a.display_name || a.agent_id || '数字人',
      jellyColor: resolveMirrorJellyColor(a),
      statusLabel: islandStatusLabel(a.status),
      runStartedAt: agentRunStartedAt(a.payload) ?? 0,
    }))
}

/**
 * 对话页乐观上岛：镜像尚未标忙时，先把当前数字人推上岛。
 */
export async function syncIslandOptimisticAgent(
  agent: PublicMirrorAgent | null | undefined,
  opts?: { forceBusy?: boolean },
): Promise<void> {
  if (!agent) return
  const row: PublicMirrorAgent =
    opts?.forceBusy && !agentBusy(agent.status)
      ? { ...agent, status: 'running' }
      : agent
  await syncIslandFromAgents([row])
}

/**
 * 根据 agents 驱动 iPhone 灵动岛。
 * 失败不写 lastKey，便于下次轮询重试。
 */
export async function syncIslandFromAgents(
  agents: PublicMirrorAgent[],
): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return

  const slices = toIslandAgents(agents)
  const count = listBusyAgents(agents).length
  const key = slices
    .map((a) => `${a.name}|${a.jellyColor}|${a.statusLabel}|${a.runStartedAt}`)
    .join(';')
  const fullKey = `${count}|${key}`
  if (fullKey === lastKey) return

  try {
    const avail = await AtollaIsland.isAvailable()
    if (!avail.available) {
      lastError = avail.reason || 'Live Activity 未开启'
      console.warn('[AtollaIsland]', lastError)
      return
    }
    if (count === 0) {
      await AtollaIsland.endAll()
      lastKey = fullKey
      lastError = ''
      return
    }
    const res = await AtollaIsland.syncBusy({ count, agents: slices })
    lastKey = fullKey
    lastError = ''
    console.info('[AtollaIsland] sync ok', { count, res })
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
