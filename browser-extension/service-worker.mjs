import {
  DEFAULT_ALLOWED_DOMAINS,
  clampTimeout,
  isAllowedURL,
  normalizeBackendURL,
  normalizeDomains,
  serializableError,
  websocketURL,
} from './lib/protocol.mjs'
import { runChatGPTPageTask } from './adapters/chatgpt.mjs'

const VERSION = chrome.runtime.getManifest().version
const SUPPORTED_ACTIONS = new Set([
  'tabs.list',
  'tabs.open',
  'dom.read',
  'dom.input',
  'dom.click',
  'page.content',
  'page.screenshot',
  'chatgpt.send_message',
])
const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com'])

let socket = null
let reconnectTimer = 0
let heartbeatTimer = 0
let reconnectAttempt = 0
let allowedDomains = [...DEFAULT_ALLOWED_DOMAINS]
let chatGPTTaskActive = false

chrome.runtime.onInstalled.addListener(async () => {
  const config = await loadConfig()
  if (!config.backendUrl) await chrome.storage.local.set({ backendUrl: 'http://127.0.0.1:8080' })
  if (!config.token) await chrome.runtime.openOptionsPage()
  connect()
})

chrome.runtime.onStartup.addListener(connect)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.backendUrl || changes.token)) reconnectNow()
})
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'status') {
    chrome.storage.local.get(['backendUrl', 'connectionState', 'lastError', 'lastConnectedAt']).then((stored) => {
      sendResponse({ ...stored, connected: socket?.readyState === WebSocket.OPEN, allowedDomains })
    })
    return true
  }
  if (message?.type === 'reconnect') {
    reconnectNow()
    sendResponse({ ok: true })
  }
  return false
})

async function clientID() {
  const stored = await chrome.storage.local.get('clientId')
  if (stored.clientId) return stored.clientId
  const id = `chrome-${crypto.randomUUID()}`
  await chrome.storage.local.set({ clientId: id })
  return id
}

async function connect() {
  clearTimeout(reconnectTimer)
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return
  const config = await loadConfig()
  if (!String(config.token || '').trim()) {
    await setConnectionState('unconfigured', '请在扩展设置中填写 Atolla Browser Token')
    return
  }
  let endpoint
  try {
    endpoint = websocketURL(config.backendUrl)
  } catch (error) {
    await setConnectionState('error', error.message)
    return
  }
  await setConnectionState('connecting', '')
  const ws = new WebSocket(endpoint)
  socket = ws
  ws.addEventListener('open', async () => {
    ws.send(JSON.stringify({ type: 'hello', token: String(config.token).trim(), client_id: await clientID(), version: VERSION }))
  })
  ws.addEventListener('message', (event) => handleSocketMessage(ws, event.data))
  ws.addEventListener('close', () => {
    if (socket === ws) socket = null
    stopHeartbeat()
    setConnectionState('disconnected', '与 Atolla 的连接已断开')
    scheduleReconnect()
  })
  ws.addEventListener('error', () => setConnectionState('error', '无法连接 Atolla 后端'))
}

// Chrome for Testing 集成测试可在临时扩展副本中放置 local-config.json；正式包不包含该文件。
async function loadConfig() {
  const stored = await chrome.storage.local.get(['backendUrl', 'token'])
  if (stored.token) return stored
  try {
    const response = await fetch(chrome.runtime.getURL('local-config.json'), { cache: 'no-store' })
    if (!response.ok) return stored
    const bootstrap = await response.json()
    const backendUrl = normalizeBackendURL(bootstrap.backendUrl)
    const token = String(bootstrap.token || '').trim()
    if (!token) return stored
    const config = { backendUrl, token }
    await chrome.storage.local.set(config)
    return config
  } catch {
    return stored
  }
}

async function handleSocketMessage(ws, raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  if (message.type === 'hello_ack') {
    allowedDomains = normalizeDomains(message.allowed_domains)
    reconnectAttempt = 0
    await chrome.storage.local.set({ allowedDomains })
    await setConnectionState('connected', '')
    startHeartbeat(ws)
    return
  }
  if (message.type !== 'task' || !message.task_id) return
  const started = Date.now()
  try {
    if (!SUPPORTED_ACTIONS.has(message.action)) throw actionError('不支持的浏览器动作', 'UNSUPPORTED_ACTION')
    const baseTimeoutMS = clampTimeout(message.timeout_ms)
    const timeoutMS = message.action === 'chatgpt.send_message' ? Math.max(10000, baseTimeoutMS) : baseTimeoutMS
    const data = await withTimeout(executeAction(message.action, message.params || {}, timeoutMS), timeoutMS)
    send(ws, { type: 'result', task_id: message.task_id, ok: true, data, duration_ms: Date.now() - started })
  } catch (error) {
    const detail = serializableError(error)
    send(ws, { type: 'result', task_id: message.task_id, ok: false, ...detail, duration_ms: Date.now() - started })
  }
}

async function executeAction(action, params, timeoutMS) {
  switch (action) {
    case 'tabs.list': return listTabs()
    case 'tabs.open': return openTab(params)
    case 'dom.read': return readDOM(params)
    case 'dom.input': return inputText(params)
    case 'dom.click': return clickElement(params)
    case 'page.content': return pageContent(params)
    case 'page.screenshot': return screenshot(params)
    case 'chatgpt.send_message': return sendChatGPTMessage(params, timeoutMS)
    default: throw actionError('不支持的浏览器动作', 'UNSUPPORTED_ACTION')
  }
}

async function listTabs() {
  const tabs = await chrome.tabs.query({})
  return {
    tabs: tabs.filter((tab) => isAllowedURL(tab.url, allowedDomains)).map((tab) => ({
      id: tab.id,
      window_id: tab.windowId,
      active: tab.active,
      title: tab.title || '',
      url: tab.url || '',
      status: tab.status || '',
    })),
  }
}

async function openTab(params) {
  if (!isAllowedURL(params.url, allowedDomains)) throw actionError('目标域名不在白名单中', 'DOMAIN_NOT_ALLOWED')
  const tab = await chrome.tabs.create({ url: params.url, active: params.active !== false })
  return { tab: tabSummary(tab) }
}

async function targetTab(params = {}) {
  let tab
  if (Number.isInteger(Number(params.tab_id)) && Number(params.tab_id) > 0) {
    tab = await chrome.tabs.get(Number(params.tab_id))
  } else {
    ;[tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  }
  if (!tab?.id) throw actionError('未找到目标标签页', 'TAB_NOT_FOUND')
  if (!isAllowedURL(tab.url, allowedDomains)) throw actionError('当前标签页域名不在白名单中', 'DOMAIN_NOT_ALLOWED')
  return tab
}

async function runInTab(tabID, func, args) {
  const results = await chrome.scripting.executeScript({ target: { tabId: tabID }, func, args })
  const first = results?.[0]
  if (!first) throw actionError('页面未返回执行结果', 'EMPTY_SCRIPT_RESULT')
  return first.result
}

async function readDOM(params) {
  const tab = await targetTab(params)
  const selector = String(params.selector || 'body')
  const maxLength = Math.max(1, Math.min(200000, Number(params.max_length) || 50000))
  return runInTab(tab.id, (cssSelector, limit) => {
    const element = document.querySelector(cssSelector)
    if (!element) return { found: false, selector: cssSelector }
    const attributes = Object.fromEntries([...element.attributes].slice(0, 50).map((item) => [item.name, item.value]))
    return {
      found: true,
      selector: cssSelector,
      tag: element.tagName.toLowerCase(),
      text: String(element.innerText || element.textContent || '').slice(0, limit),
      html: String(element.outerHTML || '').slice(0, limit),
      value: 'value' in element ? String(element.value || '').slice(0, limit) : undefined,
      attributes,
    }
  }, [selector, maxLength])
}

async function inputText(params) {
  const tab = await targetTab(params)
  const selector = String(params.selector || '')
  if (!selector) throw actionError('selector 不能为空', 'INVALID_SELECTOR')
  const text = String(params.text ?? '')
  return runInTab(tab.id, (cssSelector, value) => {
    const element = document.querySelector(cssSelector)
    if (!element) return { found: false, selector: cssSelector }
    element.focus()
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(element, value)
      else element.value = value
    } else if (element.isContentEditable) {
      element.textContent = value
    } else {
      return { found: true, editable: false, selector: cssSelector }
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return { found: true, editable: true, selector: cssSelector, value }
  }, [selector, text])
}

async function clickElement(params) {
  const tab = await targetTab(params)
  const selector = String(params.selector || '')
  if (!selector) throw actionError('selector 不能为空', 'INVALID_SELECTOR')
  return runInTab(tab.id, (cssSelector) => {
    const element = document.querySelector(cssSelector)
    if (!element) return { found: false, selector: cssSelector }
    element.scrollIntoView({ block: 'center', inline: 'center' })
    element.click()
    return { found: true, clicked: true, selector: cssSelector, tag: element.tagName.toLowerCase() }
  }, [selector])
}

async function pageContent(params) {
  const tab = await targetTab(params)
  const maxLength = Math.max(1, Math.min(500000, Number(params.max_length) || 100000))
  return runInTab(tab.id, (limit, includeHTML) => ({
    title: document.title,
    url: location.href,
    text: String(document.body?.innerText || '').slice(0, limit),
    html: includeHTML ? String(document.documentElement?.outerHTML || '').slice(0, limit) : undefined,
  }), [maxLength, params.include_html === true])
}

function isChatGPTURL(rawURL) {
  try {
    const url = new URL(String(rawURL || ''))
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

async function waitForTabComplete(tabID, timeoutMS = 15000) {
  const deadline = Date.now() + timeoutMS
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabID)
    if (tab.status === 'complete') return tab
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw actionError('ChatGPT 页面加载超时', 'CHATGPT_PAGE_TIMEOUT')
}

async function chatGPTTab(params) {
  let tab
  if (Number.isInteger(Number(params.tab_id)) && Number(params.tab_id) > 0) {
    tab = await chrome.tabs.get(Number(params.tab_id))
  } else {
    const tabs = await chrome.tabs.query({})
    tab = tabs.find((item) => item.active && isChatGPTURL(item.url)) || tabs.find((item) => isChatGPTURL(item.url))
  }
  if (!tab?.id) {
    if (params.open_new === false) throw actionError('未找到已打开的 ChatGPT 标签页', 'CHATGPT_TAB_NOT_FOUND')
    if (!isAllowedURL('https://chatgpt.com/', allowedDomains)) {
      throw actionError('chatgpt.com 不在浏览器域名白名单中', 'DOMAIN_NOT_ALLOWED')
    }
    tab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: params.active !== false })
  }
  if (!isChatGPTURL(tab.url) || !isAllowedURL(tab.url, allowedDomains)) {
    throw actionError('目标标签页不是白名单内的 ChatGPT 页面', 'CHATGPT_INVALID_TAB')
  }
  return waitForTabComplete(tab.id)
}

async function sendChatGPTMessage(params, timeoutMS) {
  const text = String(params.text ?? '').trim()
  if (!text) throw actionError('text 不能为空', 'CHATGPT_EMPTY_MESSAGE')
  if (chatGPTTaskActive) throw actionError('已有 ChatGPT 任务正在执行', 'CHATGPT_BUSY')

  chatGPTTaskActive = true
  try {
    const tab = await chatGPTTab(params)
    // 页面内监听比外层任务少预留 500ms，确保超时时先清理观察器，再释放任务锁。
    const pageTimeoutMS = Math.max(1000, timeoutMS - 500)
    const result = await runInTab(tab.id, runChatGPTPageTask, [text, pageTimeoutMS])

    if (!result?.ok) {
      throw actionError(
        result?.error || 'ChatGPT 页面操作失败',
        result?.code || 'CHATGPT_PAGE_ERROR',
        result?.diagnostics ? { diagnostics: result.diagnostics } : undefined
      )
    }
    const latestTab = await chrome.tabs.get(tab.id)
    return { tab: tabSummary(latestTab), response: result.response, conversation_url: result.conversation_url, title: result.title }
  } finally {
    chatGPTTaskActive = false
  }
}

async function screenshot(params) {
  let tab = await targetTab(params)
  if (!tab.active) {
    if (params.activate !== true) throw actionError('截图要求目标标签页处于活动状态；可传 activate=true', 'TAB_NOT_ACTIVE')
    tab = await chrome.tabs.update(tab.id, { active: true })
  }
  const format = params.format === 'jpeg' ? 'jpeg' : 'png'
  const quality = format === 'jpeg' ? Math.max(1, Math.min(100, Number(params.quality) || 85)) : undefined
  const dataURL = await chrome.tabs.captureVisibleTab(tab.windowId, { format, ...(quality ? { quality } : {}) })
  return { tab: tabSummary(tab), format, data_url: dataURL }
}

function tabSummary(tab) {
  return { id: tab.id, window_id: tab.windowId, active: tab.active, title: tab.title || '', url: tab.url || '', status: tab.status || '' }
}

function actionError(message, code, data) {
  const error = new Error(message)
  error.code = code
  if (data !== undefined) error.data = data
  return error
}

function withTimeout(promise, timeoutMS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(actionError('浏览器任务执行超时', 'TASK_TIMEOUT')), timeoutMS)),
  ])
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
}

function startHeartbeat(ws) {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => send(ws, { type: 'heartbeat', at: Date.now() }), 20000)
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer)
  heartbeatTimer = 0
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectAttempt += 1
  const delay = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempt, 5)))
  reconnectTimer = setTimeout(connect, delay)
}

function reconnectNow() {
  clearTimeout(reconnectTimer)
  reconnectAttempt = 0
  socket?.close()
  socket = null
  connect()
}

async function setConnectionState(connectionState, lastError) {
  await chrome.storage.local.set({
    connectionState,
    lastError,
    ...(connectionState === 'connected' ? { lastConnectedAt: new Date().toISOString() } : {}),
  })
}

connect()
