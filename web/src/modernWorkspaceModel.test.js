import test from 'node:test'
import assert from 'node:assert/strict'

import {
  conversationDisplayTitle,
  conversationNeedsActivation,
  filterConversationSummaries,
  groupRecentConversations,
  highestAgentState,
  movePickerSelection,
  normalizeUIStyle,
  sortConversationSummaries,
  uniqueLatestAgentConversations,
} from './modernWorkspaceModel.js'

test('viewing an active busy conversation does not request a conversation switch', () => {
  assert.equal(conversationNeedsActivation({ active: true, agent_status: 'running' }), false)
  assert.equal(conversationNeedsActivation({ active: true, agent_status: 'idle' }), false)
  assert.equal(conversationNeedsActivation({ active: false, agent_status: 'running' }), true)
})

test('normalizeUIStyle keeps only supported values', () => {
  assert.equal(normalizeUIStyle('modern'), 'modern')
  assert.equal(normalizeUIStyle('classic'), 'classic')
  assert.equal(normalizeUIStyle('broken'), 'classic')
})

test('conversation title and search have readable fallbacks', () => {
  assert.equal(conversationDisplayTitle({ title: '', preview: '  排查中继问题  ' }), '排查中继问题')
  assert.equal(conversationDisplayTitle({}), '新对话')
  const items = [{ title: '接口排查', agent_name: '小 A' }, { title: '写文档', agent_name: '小 B' }]
  assert.deepEqual(filterConversationSummaries(items, '小 b'), [items[1]])
  assert.deepEqual(filterConversationSummaries(items, '接口'), [])
})

test('recent conversations are grouped by local day', () => {
  const now = new Date('2026-10-23T12:00:00+08:00')
  const items = [
    { id: 1, updated_at: '2026-10-23T09:00:00+08:00' },
    { id: 2, updated_at: '2026-10-22T09:00:00+08:00' },
    { id: 3, updated_at: '2026-10-18T09:00:00+08:00' },
  ]
  assert.deepEqual(groupRecentConversations(items, now).map((g) => g.label), ['今天', '昨天', '7 天内'])
})

test('latest active conversation is always listed first', () => {
  const older = { id: 1, updated_at: '2026-10-23T08:00:00+08:00', pinned: true }
  const newer = { id: 2, updated_at: '2026-10-23T10:00:00+08:00' }
  assert.deepEqual(sortConversationSummaries([older, newer]).map((item) => item.id), [2, 1])
})

test('sidebar keeps only the latest conversation for each agent name', () => {
  const items = [
    { id: 1, agent_id: 10, agent_name: '全栈-小X', updated_at: '2026-10-23T08:00:00+08:00' },
    { id: 2, agent_id: 10, agent_name: '全栈-小X', updated_at: '2026-10-23T10:00:00+08:00' },
    { id: 3, agent_id: 11, agent_name: ' 全栈-小x ', updated_at: '2026-10-23T09:00:00+08:00' },
    { id: 4, agent_id: 12, agent_name: '产品-小A', updated_at: '2026-10-23T07:00:00+08:00' },
  ]
  assert.deepEqual(uniqueLatestAgentConversations(items).map((item) => item.id), [2, 4])
})

test('state priority is error, approval, running, completed', () => {
  assert.equal(highestAgentState({ agent_status: 'error', task_unread_kind: 'approval', task_unread: true }), 'error')
  assert.equal(highestAgentState({ task_unread_kind: 'approval', task_unread: true, agent_status: 'running' }), 'approval')
  assert.equal(highestAgentState({ agent_status: 'running', task_unread: true }), 'running')
  assert.equal(highestAgentState({ task_unread: true }), 'completed')
})

test('picker keyboard selection wraps safely', () => {
  assert.equal(movePickerSelection(0, 1, 3), 1)
  assert.equal(movePickerSelection(2, 1, 3), 0)
  assert.equal(movePickerSelection(0, -1, 3), 2)
  assert.equal(movePickerSelection(3, 1, 0), 0)
})
