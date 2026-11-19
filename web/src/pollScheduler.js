export const POLL_IDLE_MS = 8000
export const POLL_BUSY_MS = 2000
export const POLL_SSE_BACKUP_MS = 6000
export const POLL_TASK_PLAN_IDLE_MS = 10000
export const POLL_TASK_PLAN_AWAITING_MS = 2000
export const PC_VIEWER_VISIBLE_MS = 8000
export const PC_VIEWER_HIDDEN_MS = 30000

/** 同 key 请求单飞：飞行中再触发则标记 pending，结束后补跑最后一次 */
export function createSingleFlight() {
  const flying = new Map() // key -> Promise
  const pending = new Set()
  return async function singleFlight(key, fn) {
    if (flying.has(key)) {
      pending.add(key)
      return flying.get(key)
    }
    const run = (async () => {
      try {
        return await fn()
      } finally {
        flying.delete(key)
        if (pending.has(key)) {
          pending.delete(key)
          void singleFlight(key, fn)
        }
      }
    })()
    flying.set(key, run)
    return run
  }
}

/** 监听页面可见性；订阅时立即同步一次当前 visible 布尔值。 */
export function subscribePageVisible(onChange) {
  const notify = () => {
    onChange(document.visibilityState === 'visible')
  }
  document.addEventListener('visibilitychange', notify)
  notify()
  return () => document.removeEventListener('visibilitychange', notify)
}
