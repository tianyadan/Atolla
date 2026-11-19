import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const startScript = fileURLToPath(new URL('./start.sh', import.meta.url))

test('前后台启动都校验直接依赖是否完整', () => {
  const source = readFileSync(startScript, 'utf8')
  const checks = source.match(/npm ls --depth=0/g) ?? []

  assert.equal(checks.length, 2)
})
