import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compressImageFile } from './agentAvatar.js'

test('compressImageFile 导出为函数', () => {
  assert.equal(typeof compressImageFile, 'function')
})
