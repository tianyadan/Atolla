/** iOS 聊天输入框的可增长区间，避免内容顶开底部操作区。 */
export const COMPOSER_MIN_HEIGHT = 44
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
