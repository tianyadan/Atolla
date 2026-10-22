/** 从正文解析 @[Name](#agent:ID) 提及的员工 ID（去重保序） */
export function parseMentionAgentIds(text) {
  const ids = []
  const seen = new Set()
  const re = /@\[[^\]]*\]\(#agent:(\d+)\)/g
  let m
  const s = String(text || '')
  while ((m = re.exec(s)) !== null) {
    const id = Number(m[1])
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** 群主 ∪ @ 成员，去重；返回是否落在可建群人数区间 [3,5] */
export function buildGroupMemberSet(ownerAgentId, questionText) {
  const owner = Number(ownerAgentId) || 0
  const mentioned = parseMentionAgentIds(questionText)
  const ids = []
  const seen = new Set()
  if (owner > 0) {
    ids.push(owner)
    seen.add(owner)
  }
  for (const id of mentioned) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return {
    memberIds: ids,
    canOfferGroup: ids.length >= 3 && ids.length <= 5,
  }
}
