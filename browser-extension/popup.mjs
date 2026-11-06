async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: 'status' })
  const connected = Boolean(status?.connected)
  document.querySelector('#status-dot').className = `status-dot ${connected ? 'online' : 'offline'}`
  document.querySelector('#status-text').textContent = connected ? '已连接本机 Atolla' : (status?.lastError || '未连接')
  document.querySelector('#domains').textContent = `允许域名：${(status?.allowedDomains || []).join(', ') || '未同步'}`
}

document.querySelector('#reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' })
  setTimeout(refresh, 500)
})
document.querySelector('#options').addEventListener('click', () => chrome.runtime.openOptionsPage())
refresh()
