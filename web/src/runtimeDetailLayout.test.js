import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const component = fs.readFileSync(new URL('./AgentRuntimeDetail.jsx', import.meta.url), 'utf8')
const managedAgents = fs.readFileSync(new URL('./ManagedAgents.jsx', import.meta.url), 'utf8')

test('Runtime Detail 使用浮层定位，不参与聊天区高度计算', () => {
  assert.match(css, /\.ma-composer\s*\{[^}]*position:\s*relative/s)
  assert.match(css, /\.ma-runtime-sheet\s*\{[^}]*position:\s*absolute/s)
  assert.match(css, /\.ma-runtime-sheet\s*\{[^}]*bottom:\s*calc\(100%\s*\+\s*8px\)/s)
})

test('Runtime Detail 展示工具调用内容', () => {
  assert.match(component, /<span>调用内容<\/span>/)
  assert.match(component, /tool\.summary/)
})

test('Runtime Detail 工具明细限制高度并独立滚动', () => {
  assert.match(component, /className="ma-runtime-tool-scroll"/)
  assert.match(css, /\.ma-runtime-tool-scroll\s*\{[^}]*max-height:\s*min\(24vh,\s*220px\)/s)
  assert.match(css, /\.ma-runtime-tool-scroll\s*\{[^}]*overflow:\s*auto/s)
  assert.match(css, /\.ma-runtime-tool-row\.is-head\s*\{[^}]*position:\s*sticky/s)
})

test('Runtime Detail 在原面板内切换工具与模型调用并限制内部高度', () => {
  assert.match(component, /工具调用/)
  assert.match(component, /模型调用/)
  assert.match(component, /ma-runtime-trace-layout/)
  assert.match(component, /平台可见输入/)
  assert.match(css, /\.ma-runtime-trace-layout\s*\{[^}]*height:\s*min\(34vh,\s*340px\)/s)
  assert.match(css, /\.ma-runtime-trace-list,\s*\.ma-runtime-trace-detail\s*\{[^}]*overflow:\s*auto/s)
})

test('输入框工具按钮悬停时展示功能名称气泡', () => {
  assert.match(managedAgents, /data-tooltip="Task Plan"/)
  assert.match(managedAgents, /data-tooltip="Task Queue"/)
  assert.match(managedAgents, /data-tooltip="Runtime Detail"/)
  assert.match(css, /\.ma-composer-tool::before\s*\{[^}]*content:\s*attr\(data-tooltip\)/s)
  assert.match(css, /\.ma-composer-tool:hover::before/)
  assert.match(css, /\.ma-composer-tool:focus-visible::before/)
})

test('任务队列紫色徽标显示在输入框 Task Queue 按钮上', () => {
  const taskQueueRail = fs.readFileSync(new URL('./TaskQueueRail.jsx', import.meta.url), 'utf8')
  assert.match(taskQueueRail, /onBadgeChange\?\.\(badge\)/)
  assert.match(managedAgents, /onBadgeChange=\{setTaskQueueBadge\}/)
  assert.match(managedAgents, /className="ma-composer-tool-badge"/)
  assert.match(css, /\.ma-composer-tool-badge\s*\{[^}]*top:\s*-6px;[^}]*right:\s*-7px;/s)
  assert.match(css, /\.ma-composer-tool-badge\s*\{[^}]*background:\s*#7c3aed;/s)
})
