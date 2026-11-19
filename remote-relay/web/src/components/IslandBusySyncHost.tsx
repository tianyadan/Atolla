import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchAgents, fetchPendingInstancePermissions, getUnlockToken } from '../api'
import { buildIslandEvents, selectIslandPresentation } from '../islandEvents'
import { resetIslandSyncKey, syncIslandPresentation } from '../islandLiveActivity'
import { subscribeIslandSyncInvalidation } from '../islandSyncInvalidation'

const POLL_MS_FG = 30_000

/**
 * 全局同步忙碌数字人并上岛。
 * 业务事件立即失效，前台每 30s 低频校准；后台完全停止本地轮询。
 */
export function IslandBusySyncHost() {
  const location = useLocation()
  const instanceId = parseInstanceId(location.pathname)
  const genRef = useRef(0)
  const instanceRef = useRef(instanceId)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    instanceRef.current = instanceId
  }, [instanceId])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return

    // 离开实例或未解锁：立刻下岛，避免停轮询后锁屏残留
    if (!instanceId || !getUnlockToken(instanceId)) {
      resetIslandSyncKey()
      void syncIslandPresentation({ activeKind: null, count: 0, items: [], presentation: 'list' })
      return
    }

    resetIslandSyncKey()
    let cancelled = false
    const gen = ++genRef.current

    /** 拉取镜像并同步灵动岛 */
    async function tick() {
      const id = instanceRef.current
      if (cancelled || gen !== genRef.current || !id) return
      try {
        // 任一数据源失败都保留岛上旧状态，避免瞬时网络错误把活动清空。
        const [agents, permissions] = await Promise.all([
          fetchAgents(id),
          fetchPendingInstancePermissions(id),
        ])
        if (cancelled || gen !== genRef.current) return
        const events = buildIslandEvents(id, agents, permissions)
        await syncIslandPresentation(selectIslandPresentation(events), id)
      } catch {
        /* 未解锁 / 网络：下轮重试 */
      }
    }

    /** 只在前台启动低频校准。 */
    function startPolling() {
      stopPolling()
      if (cancelled) return
      intervalRef.current = window.setInterval(() => {
        void tick()
      }, POLL_MS_FG)
    }

    function stopPolling() {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    let appActive = document.visibilityState !== 'hidden'
    if (appActive) {
      void tick()
      startPolling()
    }

    const invalidate = () => {
      resetIslandSyncKey()
      if (appActive) void tick()
    }
    const unsubscribeInvalidation = subscribeIslandSyncInvalidation(invalidate)

    let appHandle: { remove: () => Promise<void> } | undefined
    void App.addListener('appStateChange', ({ isActive }) => {
      setAppActive(isActive)
    }).then((h) => {
      appHandle = h
    })

    function setAppActive(next: boolean) {
      if (appActive === next) return
      appActive = next
      resetIslandSyncKey()
      if (next) {
        // 回前台立即校准，再恢复低频兜底。
        void tick()
        startPolling()
      } else {
        stopPolling()
      }
    }

    const onVisibility = () => {
      setAppActive(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stopPolling()
      unsubscribeInvalidation()
      void appHandle?.remove()
      document.removeEventListener('visibilitychange', onVisibility)
      void syncIslandPresentation({ activeKind: null, count: 0, items: [], presentation: 'list' })
    }
  }, [instanceId])

  return null
}

/** 从 /instances/:id/... 解析实例 id */
function parseInstanceId(pathname: string): string {
  const m = pathname.match(/^\/instances\/([^/]+)/)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}
