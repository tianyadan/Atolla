import { normalizeJellyColor } from './jellyColor.js'

/** 精灵图：每格 16px 逻辑像素 */
export const JELLY_CELL = 16
export const JELLY_FRAMES = 8

/**
 * 按显示尺寸选最清晰的精灵图密度（1x / 2x / 3x）。
 * @param {number} size
 * @param {number} [dpr]
 */
export function pickSpriteScale(size, dpr = 1) {
  const need = size * (dpr || 1)
  if (need <= 16) return 1
  if (need <= 32) return 2
  return 3
}

/**
 * 精灵图 URL。
 * @param {string} color
 * @param {number} scale
 */
export function jellySpriteUrl(color, scale) {
  const c = normalizeJellyColor(color) || 'blue'
  const px = JELLY_CELL * scale
  return `/jelly-sprites/jelly-${c}@${px}.png`
}

/**
 * 是否应跳过位移动画（尊重系统偏好）。
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
