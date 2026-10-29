/**
 * 结束后用 DB 校准聊天时：
 * - 按 id 合并，保证手机新消息与 DB 页能进入 PC 轨
 * - 同 id 的 assistant：本地更长则保留本地（DB 被 compact 清短时）
 * - 本地流式重复拼接时回退 DB
 * - 无 id 的本地命令不追加（否则会顶到最终回复后面）
 * - 保留尚未落库的乐观 user（pending / 无 id），避免轮询 force 校准把刚发的气泡冲掉
 * - 仅保留未落库的流式 assistant 正文
 */
export function coalesceChatLog(local = [], fromDb = []) {
  if (!local.length) return fromDb
  if (!fromDb.length) return local

  const byId = new Map()
  for (const m of fromDb) {
    if (m?.id == null) continue
    byId.set(m.id, m)
  }

  for (const m of local) {
    if (m?.id == null) continue
    const db = byId.get(m.id)
    if (!db) {
      // 当前页 DB 未带回的更早消息（本地曾 loadOlder）
      byId.set(m.id, m)
      continue
    }
    if (m.role === 'assistant') {
      const localText = (m.content || '').trim()
      const dbText = (db.content || '').trim()
      const localClean = stripRepeatedAssistantTail(localText)
      if (looksLikeDuplicatedAssistant(localText, dbText)) {
        byId.set(m.id, dbText ? db : { ...m, content: localClean })
      } else if (localClean.length > dbText.length) {
        byId.set(m.id, {
          ...db,
          content: localClean,
          replySec: m.replySec ?? db.replySec,
          attachments: (m.attachments?.length ? m.attachments : db.attachments) || [],
        })
      } else if (m.attachments?.length && !(db.attachments?.length)) {
        byId.set(m.id, { ...db, attachments: m.attachments })
      }
    }
  }

  const merged = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))

  // 乐观发送的 user：DB 尚未带回时保留，避免「发出去看不见」
  appendPendingLocalUsers(merged, local)

  // 取本地最长的无 id assistant（本轮流式汇总）
  let bestLocalAsst = null
  for (const m of local) {
    if (m?.id != null || m.role !== 'assistant') continue
    const text = (m.content || '').trim()
    if (!text) continue
    if (!bestLocalAsst || text.length >= (bestLocalAsst.content || '').trim().length) {
      bestLocalAsst = m
    }
  }
  if (!bestLocalAsst) return merged

  const text = (bestLocalAsst.content || '').trim()
  let matchedIdx = -1
  for (let i = merged.length - 1; i >= 0; i--) {
    if (merged[i].role !== 'assistant') continue
    const dbText = (merged[i].content || '').trim()
    if (!dbText) continue
    const head = text.slice(0, Math.min(48, text.length))
    if (text === dbText || text.includes(dbText) || dbText.includes(head)) {
      matchedIdx = i
      break
    }
  }

  const cleanLocal = stripRepeatedAssistantTail(bestLocalAsst.content || '')

  if (matchedIdx >= 0) {
    const dbText = (merged[matchedIdx].content || '').trim()
    if (looksLikeDuplicatedAssistant(text, dbText)) {
      return merged
    }
    if (cleanLocal.trim().length > dbText.length) {
      merged[matchedIdx] = {
        ...merged[matchedIdx],
        content: cleanLocal,
        replySec: bestLocalAsst.replySec ?? merged[matchedIdx].replySec,
        attachments: (bestLocalAsst.attachments?.length
          ? bestLocalAsst.attachments
          : merged[matchedIdx].attachments) || [],
      }
    }
    return merged
  }

  // DB 页尚无对应正文：把流式回复接到末尾，避免「只有命令」
  merged.push({
    role: 'assistant',
    content: cleanLocal,
    time: bestLocalAsst.time,
    replySec: bestLocalAsst.replySec,
    attachments: bestLocalAsst.attachments || [],
  })
  return merged
}

/** 追加本地尚未在 DB 中出现的 user（乐观发送）；不追加无 id command */
function appendPendingLocalUsers(merged, local) {
  const dbUserContents = new Map()
  for (const m of merged) {
    if (m.role !== 'user') continue
    const key = String(m.content || '')
    dbUserContents.set(key, (dbUserContents.get(key) || 0) + 1)
  }
  const localCounts = new Map()
  for (const m of local) {
    if (m?.id != null || m.role !== 'user') continue
    // pending 或无 id 的乐观气泡都保留
    const key = String(m.content || '')
    const seen = localCounts.get(key) || 0
    localCounts.set(key, seen + 1)
    const dbCount = dbUserContents.get(key) || 0
    if (seen < dbCount) continue
    merged.push({
      role: 'user',
      content: m.content,
      attachments: m.attachments || [],
      time: m.time,
      pending: true,
    })
  }
}

/**
 * 剥掉「后半段与前文完全重复」的尾巴（例如「改动/建议提交」整节贴了两次）。
 * 找不到稳定重复则原样返回。
 */
export function stripRepeatedAssistantTail(text) {
  const s = String(text || '')
  if (s.length < 80) return s
  const max = Math.floor(s.length / 2)
  for (let len = max; len >= 48; len -= 1) {
    const tail = s.slice(s.length - len)
    const earlierAt = s.indexOf(tail)
    if (earlierAt >= 0 && earlierAt <= s.length - len - 1) {
      return s.slice(0, s.length - len).replace(/\s+$/u, '')
    }
  }
  return s
}

/** 检测流式重复拼接：同一长句块出现两次，或本地 = 结论 +（过程+结论/DB） */
export function looksLikeDuplicatedAssistant(localText, dbText = '') {
  const local = String(localText || '').trim()
  if (local.length < 60) return false

  if (stripRepeatedAssistantTail(local) !== local) return true

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
    if (local.endsWith(db)) {
      const head = local.slice(0, local.length - db.length).trim()
      if (head.length >= 20 && db.includes(head.slice(0, Math.min(head.length, 120)))) {
        return true
      }
    }
  }
  return false
}

/** 追加 chunk 前：若本段已在气泡中则跳过，避免引擎重放造成「改动」贴两次 */
export function shouldAppendAssistantChunk(prevContent, piece) {
  const cur = String(prevContent || '')
  const p = String(piece || '')
  if (!p) return false
  if (!cur) return true
  if (cur.endsWith(p)) return false
  const trimmed = p.replace(/^\s+/u, '')
  if (trimmed.length >= 32 && cur.includes(trimmed)) return false
  if (p.length >= cur.length + 16 && (p.endsWith(cur) || p.includes(cur.trim()))) return false
  return true
}
