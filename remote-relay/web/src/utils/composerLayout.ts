/**
 * 输入框与发送按钮共用起始高度，保证单行时视觉紧凑且底部不跳动。
 * 多行内容仍可向上扩展，避免牺牲长消息输入体验。
 */
export const COMPOSER_MIN_HEIGHT = 40
export const COMPOSER_MAX_HEIGHT = 160

export function clampComposerHeight(height: number): number {
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.round(height)))
}

/** 紧凑运行栏使用的稳定时长格式，避免秒数位数变化造成布局跳动。 */
export function formatElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  if (safeSeconds < 60) return `${safeSeconds}s`
  const minutes = Math.floor(safeSeconds / 60)
  return `${minutes}m ${String(safeSeconds % 60).padStart(2, '0')}s`
}
