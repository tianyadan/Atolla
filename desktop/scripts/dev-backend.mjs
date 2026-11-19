/** 开发态后端的唯一所有者；窗口热重启只调用 ensure，不会停止 Go。 */
export function createDevBackendManager({ start }) {
  let backend = null
  let userDataPath = null
  let closed = false
  let operation = Promise.resolve()

  function enqueue(action) {
    const next = operation.then(action)
    operation = next.catch(() => {})
    return next
  }

  return {
    ensure(path) {
      return enqueue(async () => {
        if (closed) throw new Error('开发运行器正在退出')
        if (userDataPath && userDataPath !== path) throw new Error('Electron 数据目录发生变化')
        userDataPath = path
        if (backend?.child && (backend.child.exitCode !== null || backend.child.signalCode !== null)) {
          await backend.stop()
          backend = null
        }
        if (!backend) backend = await start(path)
        return backend
      })
    },
    restart() {
      return enqueue(async () => {
        if (closed || !userDataPath) throw new Error('开发后端尚未启动')
        const previous = backend
        backend = null
        await previous?.stop()
        backend = await start(userDataPath)
        return backend
      })
    },
    shutdown() {
      return enqueue(async () => {
        closed = true
        const previous = backend
        backend = null
        await previous?.stop()
      })
    },
  }
}
