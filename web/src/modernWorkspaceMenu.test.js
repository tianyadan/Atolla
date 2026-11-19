import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./ModernWorkspace.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./styles/modern-workspace.css', import.meta.url), 'utf8')

test('PC 端账户操作收拢到三点菜单，前台对话置顶且退出登录置底', () => {
  assert.doesNotMatch(source, /modern-account-menu/)
  assert.doesNotMatch(source, /setAccountOpen\(/, '移除账户菜单后不得保留失效的状态更新')

  const menuStart = source.indexOf('id="modern-more-menu"')
  const frontend = source.indexOf("onOpenFrontend?.()", menuStart)
  const modules = source.indexOf('{moreGroups.map', menuStart)
  const logout = source.indexOf('onLogout?.()', menuStart)
  const version = source.indexOf('className="modern-more-version"', menuStart)

  assert.ok(menuStart >= 0, '应保留三点菜单容器')
  assert.ok(frontend > menuStart && frontend < modules, '前台对话应位于功能菜单之前')
  assert.ok(logout > version, '退出登录应位于版本信息之后，作为菜单最后一项')
  assert.match(css, /\.modern-more-item\.danger-item\s*\{[^}]*color:\s*#ef8585/s)
})

test('PC 端三点菜单不应被固定 520px 高度强制滚动', () => {
  const menuStyles = css.match(/\.modern-more-menu\s*\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.doesNotMatch(menuStyles, /max-height:\s*min\(72vh,\s*520px\)/)
  assert.match(menuStyles, /max-height:\s*calc\(100dvh\s*-\s*72px\)/)
})
