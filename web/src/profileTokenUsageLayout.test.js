import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./ProfileTokenUsage.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const workspaceCss = fs.readFileSync(new URL('./styles/modern-workspace.css', import.meta.url), 'utf8')

test('个人 Token 热力图遵循深色工作台且不展示说明性标题', () => {
  assert.doesNotMatch(source, /<p>个人信息<\/p>/)
  assert.doesNotMatch(source, /profile-token-note/)
  assert.match(css, /\.profile-token-panel\s*\{[^}]*background:\s*var\(--modern-bg,/s)
  assert.match(css, /\.profile-heatmap-scroll\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center/s)
})

test('引擎筛选使用分段导航而不是胶囊按钮', () => {
  const tabs = css.match(/\.profile-engine-tabs\s*\{([^}]*)\}/s)?.[1] || ''
  const tab = css.match(/\.profile-engine-tab\s*\{([^}]*)\}/s)?.[1] || ''
  assert.match(tabs, /border-bottom/)
  assert.doesNotMatch(tab, /border-radius:\s*999px/)
})

test('热力图只保留页面内悬浮提示，月份按日历周列定位', () => {
  assert.doesNotMatch(source, /\s+title=\{day\.beforeStart/)
  assert.match(source, /data-tooltip=\{day\.beforeStart/)
  assert.match(css, /\.profile-months span\s*\{[^}]*position:\s*absolute/s)
  assert.match(css, /--month-week/)
})

test('切换引擎不显示页面加载文案，折叠账户入口与三点按钮共用 32px 基线', () => {
  assert.doesNotMatch(source, /profile-heatmap-status/)
  assert.match(workspaceCss, /\.modern-workspace\.is-collapsed \.modern-account-trigger\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s)
  assert.match(workspaceCss, /\.modern-workspace\.is-collapsed \.modern-more-wrap\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s)
})
