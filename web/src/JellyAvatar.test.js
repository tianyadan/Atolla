import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  JELLY_ACTION_ROW,
  JELLY_ACTION_ROWS,
  jellyActionRow,
  jellySpriteUrl,
  pickSpriteScale,
} from './jellySprite.js'

test('jellySpriteUrl 拼出正确路径', () => {
  assert.equal(jellySpriteUrl('blue', 1), '/jelly-sprites/jelly-blue@16.png')
  assert.equal(jellySpriteUrl('orange', 2), '/jelly-sprites/jelly-orange@32.png')
  assert.equal(jellySpriteUrl('red', 3), '/jelly-sprites/jelly-red@48.png')
  assert.equal(jellySpriteUrl('pink', 1), '/jelly-sprites/jelly-pink@16.png')
  assert.equal(jellySpriteUrl('sky', 2), '/jelly-sprites/jelly-sky@32.png')
  // 非法色回退 blue
  assert.equal(jellySpriteUrl('black', 1), '/jelly-sprites/jelly-blue@16.png')
})

test('pickSpriteScale 按尺寸选密度', () => {
  assert.equal(pickSpriteScale(16, 1), 1)
  assert.equal(pickSpriteScale(28, 1), 2)
  assert.equal(pickSpriteScale(72, 1), 3)
  assert.equal(pickSpriteScale(16, 2), 2)
})

test('JELLY_ACTION_ROWS 为 9（含 coding 第 9 行）', () => {
  assert.equal(JELLY_ACTION_ROWS, 9)
  assert.equal(JELLY_ACTION_ROW.ponder, 7)
  assert.equal(JELLY_ACTION_ROW.coding, 8)
})

test('jellyActionRow 映射既有动作与 coding', () => {
  assert.equal(jellyActionRow('idle'), 0)
  assert.equal(jellyActionRow('working'), 1)
  assert.equal(jellyActionRow('typing'), 1)
  assert.equal(jellyActionRow('sleep'), 2)
  assert.equal(jellyActionRow('eat'), 3)
  assert.equal(jellyActionRow('waiting'), 4)
  assert.equal(jellyActionRow('error'), 5)
  assert.equal(jellyActionRow('celebrate'), 6)
  assert.equal(jellyActionRow('ponder'), 7)
  assert.equal(jellyActionRow('coding'), 8)
  // working 仍指向 typing，不映射到 coding / ponder
  assert.notEqual(jellyActionRow('working'), JELLY_ACTION_ROW.ponder)
  assert.notEqual(jellyActionRow('working'), JELLY_ACTION_ROW.coding)
  assert.notEqual(jellyActionRow('typing'), JELLY_ACTION_ROW.coding)
})
