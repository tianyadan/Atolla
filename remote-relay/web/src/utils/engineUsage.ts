/** 与 Mac engineusage 对齐的用量窗口 */

export type EngineUsageWindow = {
  kind: string
  label: string
  hint: string
  used_percent: number
  window_minutes?: number
  resets_at?: string
  reset_hint?: string
}

export type EngineUsageRow = {
  id: string
  ok: boolean
  error?: string
  source?: string
  plan?: string
  windows: EngineUsageWindow[]
}

export type EnginesUsageResponse = {
  cached_at?: string
  ttl_seconds?: number
  engines: EngineUsageRow[]
}

/** 侧栏打开刷新：客户端 1 分钟缓存 */
export const DRAWER_USAGE_TTL_MS = 60_000

const USAGE_TTL_MS = DRAWER_USAGE_TTL_MS

/** 模块缓存：对话页反复进入不重复打 Mac */
let usageMem: {
  at: number
  ttlMs: number
  data: EnginesUsageResponse | null
  /** 用量属于某台 Mac，不能跨云端 / LAN 实例复用。 */
  instanceId: string
} = { at: 0, ttlMs: USAGE_TTL_MS, data: null, instanceId: '' }

/** 缓存是否仍新鲜（默认 1 分钟） */
export function enginesUsageCacheFresh(maxAgeMs = USAGE_TTL_MS, instanceId?: string): boolean {
  if (!usageMem.data || !usageMem.at) return false
  if (instanceId && usageMem.instanceId !== instanceId) return false
  return Date.now() - usageMem.at < Math.min(usageMem.ttlMs || maxAgeMs, maxAgeMs)
}

/** 读模块缓存 */
export function peekEnginesUsageCache(instanceId?: string): EnginesUsageResponse | null {
  if (instanceId && usageMem.instanceId !== instanceId) return null
  return usageMem.data
}

/** 写入缓存；可选同步到 iOS 桌面小组件。客户端 TTL 封顶 1 分钟。 */
export function rememberEnginesUsage(
  data: EnginesUsageResponse,
  opts?: { instanceId?: string; publishNative?: boolean },
): EnginesUsageResponse {
  const ttlSec = Number(data.ttl_seconds)
  const fromServer =
    Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1000 : USAGE_TTL_MS
  usageMem = {
    at: Date.now(),
    ttlMs: Math.min(fromServer, USAGE_TTL_MS),
    data,
    instanceId: opts?.instanceId || '',
  }
  if (opts?.publishNative !== false) {
    void import('../nativeUsage')
      .then(({ publishNativeEnginesUsage }) =>
        publishNativeEnginesUsage(data, opts?.instanceId),
      )
      .catch(() => {})
  }
  return data
}

/** 仅用于单元测试，避免模块级缓存污染后续断言。 */
export function clearEnginesUsageCacheForTest(): void {
  usageMem = { at: 0, ttlMs: USAGE_TTL_MS, data: null, instanceId: '' }
}

/** agent.engine → usage 引擎 id（Cursor CLI 在库里是 agent） */
export function usageEngineId(engine: string | null | undefined): string {
  const key = String(engine || '').toLowerCase()
  if (key === 'agent' || key === 'cursor') return 'cursor'
  if (key === 'codex') return 'codex'
  if (key === 'claude') return 'claude'
  return key
}

/** 夹紧百分比 */
export function clampUsagePct(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

/**
 * 主展示窗口：
 * - Codex → 5 小时（session）
 * - Cursor → 全量月度（totalPercentUsed / 月度），不用 Auto
 * - Claude → 5 小时 session，否则第一窗
 */
export function pickPrimaryWindow(
  engine: string | null | undefined,
  row: EngineUsageRow | null | undefined,
): EngineUsageWindow | null {
  const wins = row?.ok ? row.windows || [] : []
  if (!wins.length) return null
  const id = usageEngineId(engine)
  if (id === 'codex') {
    return (
      wins.find((w) => w.kind === 'session' || /5\s*小时|5h/i.test(w.label || '')) ||
      wins[0]
    )
  }
  if (id === 'cursor') {
    return (
      wins.find(
        (w) =>
          w.kind === 'monthly' ||
          /月度|^月$|total|全量|账单/i.test(`${w.label || ''} ${w.hint || ''}`),
      ) ||
      wins.find(
        (w) => !/auto/i.test(w.label || '') && !/auto/i.test(w.hint || ''),
      ) ||
      wins[0]
    )
  }
  return wins.find((w) => w.kind === 'session') || wins[0]
}

/** 短标签：5h / 月 / 周（详情芯片用） */
export function primaryWindowShortLabel(w: EngineUsageWindow | null): string {
  if (!w) return ''
  if (/auto/i.test(w.label || '') || /auto/i.test(w.hint || '')) return 'Auto'
  if (w.kind === 'session' || /5\s*小时|5h/i.test(w.label || '')) return '5h'
  if (w.kind === 'weekly' || /7\s*天|周/i.test(w.label || '')) return '周'
  if (w.kind === 'monthly' || /月度|^月$/i.test(w.label || '')) return '月'
  return (w.label || w.kind || '').slice(0, 4)
}

/** Claude 视为无限额度（侧栏用 ∞ 标签，不画用量条） */
export function isUnlimitedEngine(engine: string | null | undefined): boolean {
  return usageEngineId(engine) === 'claude'
}

/** 主窗口剩余额度 %（100 − 已用）；无限引擎返回 null */
export function engineRemainingPct(
  engine: string | null | undefined,
  row: EngineUsageRow | null | undefined,
): number | null {
  if (isUnlimitedEngine(engine)) return null
  const primary = pickPrimaryWindow(engine, row)
  if (!primary) return null
  return Math.max(0, Math.min(100, 100 - clampUsagePct(primary.used_percent)))
}

/** 侧栏额度文案：Claude ∞；Cursor/Codex 显示剩余百分比 */
export function drawerQuotaLabel(
  engine: string | null | undefined,
  row: EngineUsageRow | null | undefined,
): string {
  if (isUnlimitedEngine(engine)) return '∞'
  const remain = engineRemainingPct(engine, row)
  if (remain == null) return ''
  return `${remain}%`
}

/** Tooltip：说明当前条对应哪个窗口 */
export function drawerQuotaTitle(
  engine: string | null | undefined,
  row: EngineUsageRow | null | undefined,
): string {
  const id = usageEngineId(engine)
  const remain = engineRemainingPct(engine, row)
  if (id === 'claude') return 'Claude 额度无限'
  if (remain == null) return '引擎额度加载中'
  if (id === 'cursor') return `Cursor 全量剩余 ${remain}%`
  if (id === 'codex') return `Codex 5 小时剩余 ${remain}%`
  return `引擎剩余 ${remain}%`
}
