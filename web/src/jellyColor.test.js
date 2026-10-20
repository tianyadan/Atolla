import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  JELLY_COLORS,
  JELLY_COLOR_FIELD,
  assignJellyColor,
  isJellyColor,
  jellyColorPayload,
  jellyStateFromAgent,
  normalizeJellyColor,
  resolveJellyColor,
} from './jellyColor.js'

test('六色常量与字段名', () => {
  assert.deepEqual(JELLY_COLORS, ['orange', 'yellow', 'blue', 'green', 'purple', 'red'])
  assert.equal(JELLY_COLOR_FIELD, 'jelly_color')
})

test('isJellyColor / normalizeJellyColor', () => {
  assert.equal(isJellyColor('blue'), true)
  assert.equal(isJellyColor('BLUE'), true)
  assert.equal(isJellyColor('pink'), false)
  assert.equal(normalizeJellyColor(' Orange '), 'orange')
  assert.equal(normalizeJellyColor('nope'), '')
})

test('assignJellyColor 与后端 id%6 一致', () => {
  assert.equal(assignJellyColor(0), 'orange')
  assert.equal(assignJellyColor(1), 'yellow')
  assert.equal(assignJellyColor(2), 'blue')
  assert.equal(assignJellyColor(3), 'green')
  assert.equal(assignJellyColor(4), 'purple')
  assert.equal(assignJellyColor(5), 'red')
  assert.equal(assignJellyColor(6), 'orange')
  assert.equal(assignJellyColor(99), 'green') // 99 % 6 = 3
})

test('assignJellyColor 非数值 id 稳定哈希 mod 6', () => {
  const a = assignJellyColor('frontend_engineer')
  const b = assignJellyColor('frontend_engineer')
  assert.equal(a, b)
  assert.ok(JELLY_COLORS.includes(a))
})

test('resolveJellyColor 优先 jelly_color', () => {
  assert.equal(resolveJellyColor({ id: 1, jelly_color: 'red' }), 'red')
  // 过渡兼容 camelCase
  assert.equal(resolveJellyColor({ id: 1, jellyColor: 'green' }), 'green')
})

test('resolveJellyColor 无字段时按 id%6', () => {
  assert.equal(resolveJellyColor({ id: 99 }), 'green')
  assert.equal(resolveJellyColor({ id: 4 }), 'purple')
})

test('jellyColorPayload 输出 snake_case', () => {
  assert.deepEqual(jellyColorPayload('purple'), { jelly_color: 'purple' })
  assert.deepEqual(jellyColorPayload('nope'), {})
})

test('jellyStateFromAgent 映射', () => {
  assert.equal(jellyStateFromAgent({ status: 'error' }), 'error')
  assert.equal(jellyStateFromAgent({ status: 'waiting' }), 'waiting')
  assert.equal(jellyStateFromAgent({ status: 'running' }), 'working')
  assert.equal(jellyStateFromAgent({ status: 'idle' }, { streaming: true }), 'typing')
  assert.equal(jellyStateFromAgent({ status: 'idle' }, { loading: true }), 'working')
  assert.equal(jellyStateFromAgent({ status: 'done' }), 'idle')
})
