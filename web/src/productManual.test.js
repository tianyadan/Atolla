import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRODUCT_MANUAL_CATEGORIES, PRODUCT_MANUAL_ITEMS } from './productManual.js'

test('对话分类下提供命令审核、记忆与对话引用', () => {
  const conversation = PRODUCT_MANUAL_CATEGORIES[0]
  const memory = PRODUCT_MANUAL_ITEMS.find((item) => item.id === 'conversation-memory')
  const mention = PRODUCT_MANUAL_ITEMS.find((item) => item.id === 'conversation-mention')

  assert.equal(conversation.id, 'conversation')
  assert.equal(conversation.label, '对话')
  assert.deepEqual(conversation.itemIds, [
    'conversation-command-review',
    'conversation-memory',
    'conversation-mention',
  ])
  assert.equal(memory.label, '记忆')
  assert.match(memory.content, /engine_session_id/)
  assert.match(memory.content, /最近 12 轮/)
  assert.match(memory.content, /原生压缩/)
  assert.equal(mention.label, '对话引用')
  assert.match(mention.content, /三个用法/)
  assert.match(mention.content, /@沈清禾/)
  assert.match(mention.content, /交叉检查/)
})
