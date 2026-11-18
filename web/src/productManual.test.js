import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRODUCT_MANUAL_CATEGORIES, PRODUCT_MANUAL_ITEMS } from './productManual.js'

test('产品手册按九个已确认核心模块排序', () => {
  assert.deepEqual(
    PRODUCT_MANUAL_CATEGORIES.map((category) => category.id),
    [
      'platform',
      'employees',
      'conversation',
      'safety',
      'collaboration',
      'memory',
      'skills',
      'remote',
      'observability',
    ],
  )
})

test('手册文章 ID 唯一、目录全部可解析且没有孤儿文章', () => {
  const itemIds = PRODUCT_MANUAL_ITEMS.map((item) => item.id)
  assert.equal(new Set(itemIds).size, itemIds.length)

  const listedIds = []
  for (const category of PRODUCT_MANUAL_CATEGORIES) {
    assert.ok(category.label)
    assert.ok(category.description)
    assert.ok(category.itemIds.length > 0)
    for (const id of category.itemIds) {
      const item = PRODUCT_MANUAL_ITEMS.find((candidate) => candidate.id === id)
      assert.ok(item, `missing manual item: ${id}`)
      assert.equal(item.categoryId, category.id)
      listedIds.push(id)
    }
  }

  assert.deepEqual([...listedIds].sort(), [...itemIds].sort())
  assert.equal(new Set(listedIds).size, listedIds.length)
})

test('全部产品手册文章包含标准结构', () => {
  const items = PRODUCT_MANUAL_ITEMS
  assert.ok(items.length > 0)
  for (const item of items) {
    assert.match(item.content, /^#\s+\S/m, `${item.id} missing title`)
    assert.match(item.content, /```text[\s\S]+?```/, `${item.id} missing text flow`)
    assert.match(item.content, /## 实现逻辑/, `${item.id} missing implementation section`)
    assert.match(item.content, /## 边界说明/, `${item.id} missing boundary section`)
  }
})

test('产品手册不再引导用户使用已废弃的项目协作流程图', () => {
  const content = PRODUCT_MANUAL_ITEMS.map((item) => item.content).join('\n')
  assert.doesNotMatch(content, /项目协作/)
  assert.doesNotMatch(content, /Workflow Canvas/i)
  assert.doesNotMatch(content, /改用项目协作/)
})
