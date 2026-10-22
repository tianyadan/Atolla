import { normalizeJellyColor } from './jellyColor'

/** 精灵图：每格 16px 逻辑像素 */
export const JELLY_CELL = 16
export const JELLY_FRAMES = 8
/** v2 素材：8 列 × 7 行动作 */
export const JELLY_ACTION_ROWS = 7

/**
 * 动作行（与 public/jelly-sprites/animations.json 一致）
 * 0 idle · 1 typing · 2 sleep · 3 eat · 4 alert · 5 error · 6 celebrate
 */
export const JELLY_ACTION_ROW = {
  idle: 0,
  typing: 1,
  sleep: 2,
  eat: 3,
  alert: 4,
  error: 5,
  celebrate: 6,
  float: 0,
  jump: 1,
  working: 1,
  waiting: 4,
} as const

export type JellyActionState =
  | 'idle'
  | 'working'
  | 'typing'
  | 'waiting'
  | 'error'
  | 'sleep'
  | 'eat'
  | 'celebrate'

/** Avatar state → 精灵行 */
export function jellyActionRow(state: string | null | undefined): number {
  const s = String(state || 'idle')
  if (s === 'working' || s === 'typing') return JELLY_ACTION_ROW.typing
  if (s === 'waiting') return JELLY_ACTION_ROW.alert
  if (s === 'error') return JELLY_ACTION_ROW.error
  if (s === 'sleep') return JELLY_ACTION_ROW.sleep
  if (s === 'eat') return JELLY_ACTION_ROW.eat
  if (s === 'celebrate') return JELLY_ACTION_ROW.celebrate
  return JELLY_ACTION_ROW.idle
}

/** 按显示尺寸选最清晰的精灵图密度（1x / 2x / 3x） */
export function pickSpriteScale(size: number, dpr = 1): 1 | 2 | 3 {
  const need = size * (dpr || 1)
  if (need <= 16) return 1
  if (need <= 32) return 2
  return 3
}

/** 精灵图 URL */
export function jellySpriteUrl(color: string, scale: number): string {
  const c = normalizeJellyColor(color) || 'blue'
  const px = JELLY_CELL * scale
  return `/jelly-sprites/jelly-${c}@${px}.png`
}

/** 是否应跳过位移动画（尊重系统偏好） */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
