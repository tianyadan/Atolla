export function normalizeUIStyle(value) {
  return value === 'modern' ? 'modern' : 'classic'
}

export function conversationDisplayTitle(item = {}) {
  return String(item.title || item.preview || '').trim() || '新对话'
}

// 查看当前活动会话不等于切换线程；忙碌中的数字人也应允许直接打开查看。
export function conversationNeedsActivation(item = {}) {
  return !item.active
}

export function filterConversationSummaries(items = [], query = '') {
  const q = String(query).trim().toLocaleLowerCase()
  if (!q) return items
  return items.filter((item) => String(item.agent_name || '').toLocaleLowerCase().includes(q))
}

export function sortConversationSummaries(items = []) {
  return [...items].sort((left, right) => new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime())
}

// 现代侧栏以数字人为单位，只保留同名数字人的最近一条会话，避免重复入口造成误点。
export function uniqueLatestAgentConversations(items = []) {
  const seen = new Set()
  return sortConversationSummaries(items).filter((item) => {
    const normalizedName = String(item.agent_name || '').trim().toLocaleLowerCase()
    const key = normalizedName || `agent:${Number(item.agent_id) || 0}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function highestAgentState(item = {}) {
  const status = String(item.agent_status || item.status || '').toLowerCase()
  if (status === 'error') return 'error'
  if (item.task_unread_kind === 'approval' || Number(item.pending_approvals || 0) > 0) return 'approval'
  if (['running', 'busy', 'waiting', '插话中', 'initializing', 'compressing'].includes(status)) return 'running'
  if (item.task_unread) return 'completed'
  return 'idle'
}

export function groupRecentConversations(items = [], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const groups = [
    { label: '今天', min: start },
    { label: '昨天', min: start - 86400000 },
    { label: '7 天内', min: start - 6 * 86400000 },
    { label: '更早', min: -Infinity },
  ].map((group) => ({ ...group, items: [] }))
  for (const item of items) {
    const time = new Date(item.updated_at || item.created_at || 0).getTime()
    const target = groups.find((group) => time >= group.min) || groups[groups.length - 1]
    target.items.push(item)
  }
  return groups.filter((group) => group.items.length).map(({ label, items: groupItems }) => ({ label, items: groupItems }))
}

export function movePickerSelection(index, delta, count) {
  if (count <= 0) return 0
  return (index + delta + count) % count
}
