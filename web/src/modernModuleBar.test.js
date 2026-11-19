import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('./styles/modern-workspace.css', import.meta.url), 'utf8')

test('所有模块共用紧凑返回栏，Electron 仅保留必要的标题栏留白', () => {
  const moduleBar = css.match(/\.modern-module-bar\s*\{([^}]*)\}/s)?.[1] || ''
  const backButton = css.match(/\.modern-module-bar button\s*\{([^}]*)\}/s)?.[1] || ''
  const electronBar = css.match(/html\.atolla-electron \.modern-module-bar\s*\{([^}]*)\}/s)?.[1] || ''

  assert.match(moduleBar, /min-height:\s*36px/)
  assert.match(moduleBar, /margin-bottom:\s*10px/)
  assert.match(moduleBar, /padding:\s*4px 8px/)
  assert.match(backButton, /min-height:\s*28px/)
  assert.match(backButton, /padding:\s*4px 8px/)
  assert.match(electronBar, /padding-top:\s*28px/)
  assert.match(electronBar, /min-height:\s*60px/)
  assert.doesNotMatch(electronBar, /padding-top:\s*44px/)
})
