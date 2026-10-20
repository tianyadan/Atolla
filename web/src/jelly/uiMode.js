/** 界面模式：经典 | 水母；默认经典，持久化 localStorage。 */
export const UI_MODE_KEY = 'atolla_ui_mode'
export const UI_MODE_CLASSIC = 'classic'
export const UI_MODE_JELLY = 'jelly'

/** 读取已保存的界面模式，非法值回落经典。 */
export function readUiMode() {
  try {
    const v = localStorage.getItem(UI_MODE_KEY)
    if (v === UI_MODE_JELLY) return UI_MODE_JELLY
  } catch { /* ignore */ }
  return UI_MODE_CLASSIC
}

/** 写入界面模式。 */
export function writeUiMode(mode) {
  const next = mode === UI_MODE_JELLY ? UI_MODE_JELLY : UI_MODE_CLASSIC
  try { localStorage.setItem(UI_MODE_KEY, next) } catch { /* ignore */ }
  return next
}
