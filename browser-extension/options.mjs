import { normalizeBackendURL } from './lib/protocol.mjs'

const backendInput = document.querySelector('#backend-url')
const tokenInput = document.querySelector('#token')
const message = document.querySelector('#message')

const stored = await chrome.storage.local.get(['backendUrl', 'token'])
backendInput.value = stored.backendUrl || 'http://127.0.0.1:8080'
tokenInput.value = stored.token || ''

document.querySelector('#save').addEventListener('click', async () => {
  try {
    const backendUrl = normalizeBackendURL(backendInput.value)
    const token = tokenInput.value.trim()
    if (!token) throw new Error('Token 不能为空')
    await chrome.storage.local.set({ backendUrl, token })
    await chrome.runtime.sendMessage({ type: 'reconnect' })
    message.textContent = '已保存，正在连接…'
    message.className = 'success'
  } catch (error) {
    message.textContent = error.message
    message.className = 'error'
  }
})
