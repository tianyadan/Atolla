/**
 * 结束后用 DB 校准聊天时，若库被延迟 compact 清短，保留本地更长的 assistant。
 * 本地命令轨迹更完整时也优先本地，避免过程气泡被短页 DB 冲掉。
 * 若本地因「流式 + result 双推」把同一段拼了两遍，则回退 DB。
 */
export function coalesceChatLog(local = [], fromDb = []) {
  const isRealAsst = (m) =>
    m?.role === 'assistant'
    && (m.content || '').trim()
    && !(m.content || '').includes('上下文已由引擎压缩')

  const lastLocal = [...local].reverse().find(isRealAsst)
  const lastDb = [...fromDb].reverse().find(isRealAsst)
  const localText = (lastLocal?.content || '').trim()
  const dbText = (lastDb?.content || '').trim()
  const localLen = localText.length
  const dbLen = dbText.length
  const localCmds = local.filter((m) => m?.role === 'command').length
  const dbCmds = fromDb.filter((m) => m?.role === 'command').length

  // 本地把同一段结论拼了两遍（或本地 = DB正文 + 再拼一遍）→ 信 DB
  if (looksLikeDuplicatedAssistant(localText, dbText)) {
    return fromDb
  }

  // 本地流式正文更长：说明 DB 被 compact 清掉或尚未写入完整回复
  if (localLen > 0 && localLen > dbLen) {
    return local
  }
  // 本地命令过程更完整（且回复不更短）：保留执行轨迹
  if (localCmds > dbCmds && localLen >= dbLen) {
    return local
  }
  return fromDb
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
