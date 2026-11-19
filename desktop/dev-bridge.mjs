/** Electron 与开发运行器之间的一次性请求；仅开发态使用。 */
export function requestDevBackend(channel, request, responseType, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    if (typeof channel.send !== 'function') {
      reject(new Error('开发运行器 IPC 不可用，请通过 scripts/dev-electron.sh 启动'))
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      channel.off('message', onMessage)
    }
    const onMessage = (message) => {
      if (message?.type === 'atolla:dev-error') {
        cleanup()
        reject(new Error(message.error || '开发后端启动失败'))
      } else if (message?.type === responseType) {
        cleanup()
        resolve(message.baseUrl)
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('等待开发后端就绪超时'))
    }, timeoutMs)
    channel.on('message', onMessage)
    try {
      channel.send(request)
    } catch (error) {
      // Electron 重启时 IPC 可能已经断开，及时释放监听与超时计时器。
      cleanup()
      reject(error)
    }
  })
}
