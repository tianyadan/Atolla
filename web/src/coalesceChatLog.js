/**
 * 结束后用 DB 校准聊天时：
 * - 按 id 合并，保证手机新写入的消息能进 PC 轨（不再因本地命令气泡更多而整段丢弃 DB）
 * - 同 id 的 assistant：本地更长则保留本地（DB 被 compact 清短时）
 * - 本地流式重复拼接时回退 DB
 * - 无 id 的本地气泡（流式 assistant / status）挂在末尾
 */
export function coalesceChatLog(local = [], fromDb = []) {
  if (!local.length) return fromDb
  if (!fromDb.length) return local

  const byId = new Map()
  for (const m of fromDb) {
    if (m?.id == null) continue
    byId.set(m.id, m)
  }

  const localOnlyNoId = []
  for (const m of local) {
    if (m?.id == null) {
      // 流式中的无 id 气泡；已落库同内容时不必重复挂
      localOnlyNoId.push(m)
      continue
    }
    const db = byId.get(m.id)
    if (!db) {
      // 当前页 DB 未带回的更早消息（本地曾 loadOlder / 完整轨）
      byId.set(m.id, m)
      continue
    }
    if (m.role === 'assistant') {
      const localText = (m.content || '').trim()
      const dbText = (db.content || '').trim()
      if (looksLikeDuplicatedAssistant(localText, dbText)) {
        byId.set(m.id, db)
      } else if (localText.length > dbText.length) {
        byId.set(m.id, { ...db, content: m.content, replySec: m.replySec ?? db.replySec })
      }
    }
  }

  const merged = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))

  // 无 id 本地气泡：仅保留尚未被末尾同角色正文覆盖的（流式中）
  const lastMerged = merged[merged.length - 1]
  for (const m of localOnlyNoId) {
    if (
      m.role === 'assistant'
      && lastMerged?.role === 'assistant'
      && (lastMerged.content || '').includes((m.content || '').trim().slice(0, 40))
      && (m.content || '').trim().length <= (lastMerged.content || '').trim().length
    ) {
      continue
    }
    merged.push(m)
  }
  return merged
}

/** 检测流式重复拼接：同一长句块出现两次，或本地 = 结论 +（过程+结论/DB） */
export function looksLikeDuplicatedAssistant(localText, dbText = '') {
  const local = String(localText || '').trim()
  if (local.length < 60) return false

  // 滑动窗口：前半段某 40+ 字块在后文再次出现
  const win = Math.min(48, Math.floor(local.length / 3))
  if (win >= 32) {
    const limit = Math.floor(local.length / 2)
    for (let i = 0; i + win <= limit; i += 16) {
      const block = local.slice(i, i + win)
      if (local.indexOf(block, i + win) >= 0) return true
    }
  }

  const db = String(dbText || '').trim()
  if (db.length >= 24 && local.length > db.length) {
    const first = local.indexOf(db)
    const last = local.lastIndexOf(db)
    if (first >= 0 && last > first) return true
    // 本地以 DB 结尾，且开头那段又是 DB 的尾部（结论先推、再整段 result）
    if (local.endsWith(db)) {
      const head = local.slice(0, local.length - db.length).trim()
      if (head.length >= 20 && db.includes(head.slice(0, Math.min(head.length, 120)))) {
        return true
      }
    }
  }
  return false
}
