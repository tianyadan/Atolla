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

const USAGE_TTL_MS = 5 * 60 * 1000

/** 模块缓存：对话页反复进入不重复打 Mac */
let usageMem: {
  at: number
  ttlMs: number
  data: EnginesUsageResponse | null
} = { at: 0, ttlMs: USAGE_TTL_MS, data: null }

/** 缓存是否仍新鲜 */
export function enginesUsageCacheFresh(): boolean {
  if (!usageMem.data || !usageMem.at) return false
  return Date.now() - usageMem.at < (usageMem.ttlMs || USAGE_TTL_MS)
}

/** 读模块缓存 */
export function peekEnginesUsageCache(): EnginesUsageResponse | null {
  return usageMem.data
}

/** 写入缓存 */
export function rememberEnginesUsage(data: EnginesUsageResponse): EnginesUsageResponse {
  const ttlSec = Number(data.ttl_seconds)
  usageMem = {
    at: Date.now(),
    ttlMs: Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1000 : USAGE_TTL_MS,
    data,
  }
  return data
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
 * 顶栏主窗口：
 * - Codex → 5 小时（session）
 * - Cursor → Auto（label 含 Auto / kind session 优先）
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
    return wins.find((w) => w.kind === 'session') || wins[0]
  }
  if (id === 'cursor') {
    return (
      wins.find((w) => /auto/i.test(w.label || '') || /auto/i.test(w.hint || '')) ||
      wins.find((w) => w.kind === 'session') ||
      wins[0]
    )
  }
  // Claude：优先 5 小时
  return wins.find((w) => w.kind === 'session') || wins[0]
}

/** 短标签：5h / Auto / 周 */
export function primaryWindowShortLabel(w: EngineUsageWindow | null): string {
  if (!w) return ''
  if (/auto/i.test(w.label || '')) return 'Auto'
  if (w.kind === 'session' || /5\s*小时|5h/i.test(w.label || '')) return '5h'
  if (w.kind === 'weekly' || /7\s*天|周/i.test(w.label || '')) return '周'
  if (w.kind === 'monthly' || /月/i.test(w.label || '')) return '月'
  return (w.label || w.kind || '').slice(0, 4)
}
