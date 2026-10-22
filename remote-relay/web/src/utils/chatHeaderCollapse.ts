/** localStorage：对话页顶栏是否展开（默认展开） */
const STORAGE_KEY = 'relay_chat_header_expanded'

/** 读取顶栏展开偏好；缺省 true */
export function loadChatHeaderExpanded(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

/** 持久化顶栏展开偏好 */
export function saveChatHeaderExpanded(expanded: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0')
  } catch {
    /* quota / private mode */
  }
}
