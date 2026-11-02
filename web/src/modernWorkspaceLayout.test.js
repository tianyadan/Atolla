import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('./App.css', import.meta.url), 'utf8')

function readZIndex(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  assert.ok(block, `找不到样式：${selector}`)
  const value = block[1].match(/z-index:\s*(\d+)/)
  assert.ok(value, `${selector} 未设置 z-index`)
  return Number(value[1])
}

test('PC 端折叠侧栏的更多菜单层级高于输入框', () => {
  const sidebarZIndex = readZIndex('.modern-workspace.is-collapsed .modern-recents')
  const composerZIndex = readZIndex('.ma-composer')
  assert.ok(sidebarZIndex > composerZIndex)
  assert.match(css, /\.modern-workspace\.is-collapsed \.modern-more-menu\s*\{[^}]*position:\s*fixed/s)
})
