/**
 * 选区保护：聊天区轮询很密，替换 DOM / 自动滚底会冲掉用户正在做的划选。
 * 约定：用户按住鼠标（可能正要拖选）或有非空选区时，视为「正在选字」。
 */
let pointerDown = false

if (typeof document !== 'undefined') {
  const up = () => { pointerDown = false }
  document.addEventListener('pointerdown', () => { pointerDown = true }, true)
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', up)
}

/** 页面里存在非空选区（input/textarea 内部选区不算）。 */
export function hasTextSelection() {
  if (typeof window === 'undefined') return false
  const sel = window.getSelection?.()
  return !!sel && sel.rangeCount > 0 && !sel.isCollapsed
}

/** 正在选字，或刚按下鼠标正要拖选。 */
export function isSelectingText() {
  return pointerDown || hasTextSelection()
}
