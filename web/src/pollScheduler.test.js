import {
  createSingleFlight,
  subscribePageVisible,
  POLL_IDLE_MS,
  POLL_BUSY_MS,
  POLL_SSE_BACKUP_MS,
  POLL_TASK_PLAN_IDLE_MS,
  POLL_TASK_PLAN_AWAITING_MS,
  PC_VIEWER_VISIBLE_MS,
  PC_VIEWER_HIDDEN_MS,
} from './pollScheduler.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** Drain microtasks so void pending catch-up can start. */
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

/** Minimal Node stub for document.visibilityState + visibilitychange. */
function installDocumentStub(initialState = 'visible') {
  const listeners = new Map()
  const previous = globalThis.document
  globalThis.document = {
    visibilityState: initialState,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type)
      if (set) {
        for (const fn of [...set]) fn(event)
      }
      return true
    },
  }
  return () => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

{
  assert(POLL_IDLE_MS === 8000, 'POLL_IDLE_MS')
  assert(POLL_BUSY_MS === 2000, 'POLL_BUSY_MS')
  assert(POLL_SSE_BACKUP_MS === 6000, 'POLL_SSE_BACKUP_MS')
  assert(POLL_TASK_PLAN_IDLE_MS === 10000, 'POLL_TASK_PLAN_IDLE_MS')
  assert(POLL_TASK_PLAN_AWAITING_MS === 2000, 'POLL_TASK_PLAN_AWAITING_MS')
  assert(PC_VIEWER_VISIBLE_MS === 8000, 'PC_VIEWER_VISIBLE_MS')
  assert(PC_VIEWER_HIDDEN_MS === 30000, 'PC_VIEWER_HIDDEN_MS')
}

// 同 key 并发三次：飞行中只标记 pending，结束后补跑最后一次 → fn 执行 2 次
{
  const singleFlight = createSingleFlight()
  let calls = 0
  let release
  const fn = async () => {
    calls += 1
    if (calls === 1) {
      await new Promise((resolve) => {
        release = resolve
      })
    }
    return calls
  }

  const p1 = singleFlight('agents', fn)
  const p2 = singleFlight('agents', fn)
  const p3 = singleFlight('agents', fn)
  assert(calls === 1, 'in-flight coalesces extra same-key triggers')

  release()
  const results = await Promise.all([p1, p2, p3])
  assert(
    results.every((value) => value === 1),
    'coalesced callers share the first flight result',
  )
  await flushMicrotasks()
  assert(calls === 2, 'pending catch-up runs once after first flight (3 triggers → 2 runs)')
}

{
  const restore = installDocumentStub('hidden')
  try {
    const seen = []
    const unsubscribe = subscribePageVisible((visible) => seen.push(visible))
    assert(seen.length === 1 && seen[0] === false, 'subscribe immediately syncs current visibility')

    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    assert(seen.length === 2 && seen[1] === true, 'visibilitychange visible → true')

    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    assert(seen.length === 3 && seen[2] === false, 'visibilitychange hidden → false')

    unsubscribe()
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    assert(seen.length === 3, 'unsubscribe stops further visibility callbacks')
  } finally {
    restore()
  }
}

console.log('pollScheduler ok')
