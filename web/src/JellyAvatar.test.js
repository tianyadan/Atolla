import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jellySpriteUrl, pickSpriteScale } from './jellySprite.js'

test('jellySpriteUrl 拼出正确路径', () => {
  assert.equal(jellySpriteUrl('blue', 1), '/jelly-sprites/jelly-blue@16.png')
  assert.equal(jellySpriteUrl('orange', 2), '/jelly-sprites/jelly-orange@32.png')
  assert.equal(jellySpriteUrl('red', 3), '/jelly-sprites/jelly-red@48.png')
  // 非法色回退 blue
  assert.equal(jellySpriteUrl('pink', 1), '/jelly-sprites/jelly-blue@16.png')
})

test('pickSpriteScale 按尺寸选密度', () => {
  assert.equal(pickSpriteScale(16, 1), 1)
  assert.equal(pickSpriteScale(28, 1), 2)
  assert.equal(pickSpriteScale(72, 1), 3)
  assert.equal(pickSpriteScale(16, 2), 2)
})
