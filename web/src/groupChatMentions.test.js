import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildGroupMemberSet, parseMentionAgentIds } from './groupChatMentions.js'

test('parseMentionAgentIds 提取去重保序', () => {
  const q = '请 @[甲](#agent:10) 和 @[乙](#agent:20) 还有 @[甲](#agent:10) 一起看'
  assert.deepEqual(parseMentionAgentIds(q), [10, 20])
  assert.deepEqual(parseMentionAgentIds('hello @world'), [])
})

test('buildGroupMemberSet 3 人可弹面板', () => {
  const r = buildGroupMemberSet(1, '@[A](#agent:2) @[B](#agent:3)')
  assert.deepEqual(r.memberIds, [1, 2, 3])
  assert.equal(r.canOfferGroup, true)
})

test('buildGroupMemberSet 2 人不弹', () => {
  const r = buildGroupMemberSet(1, '@[A](#agent:2)')
  assert.deepEqual(r.memberIds, [1, 2])
  assert.equal(r.canOfferGroup, false)
})

test('buildGroupMemberSet 群主自提及去重', () => {
  const r = buildGroupMemberSet(5, '@[Me](#agent:5) @[A](#agent:6) @[B](#agent:7)')
  assert.deepEqual(r.memberIds, [5, 6, 7])
  assert.equal(r.canOfferGroup, true)
})
