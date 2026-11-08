import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchAgents, fetchPendingInstancePermissions, getUnlockToken } from '../api'
import { buildIslandEvents, selectIslandPresentation } from '../islandEvents'
import { resetIslandSyncKey, syncIslandPresentation } from '../islandLiveActivity'
import { subscribeIslandSyncInvalidation } from '../islandSyncInvalidation'

const POLL_MS = 3_000

/**
 * 全局轮询忙碌数字人并上岛。
 * 前台轮询；进后台只推最后一次态后停轮询（原生保留 Live Activity，不主动 end）。
 */
export function IslandBusySyncHost() {
  const location = useLocation()
  const instanceId = parseInstanceId(location.pathname)
  const genRef = useRef(0)
  const instanceRef = useRef(instanceId)
  const intervalRef = useRef<number | null>(null)
  const appActiveRef = useRef(true)

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

    /** 仅前台开启轮询 */
    function startPolling() {
      stopPolling()
      if (cancelled || !appActiveRef.current) return
      intervalRef.current = window.setInterval(() => {
        if (!appActiveRef.current) return
        void tick()
      }, POLL_MS)
    }

    function stopPolling() {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    void tick()
    startPolling()

    const invalidate = () => {
      if (!appActiveRef.current) return
      void tick()
    }
    const unsubscribeInvalidation = subscribeIslandSyncInvalidation(invalidate)

    let appHandle: { remove: () => Promise<void> } | undefined
    void App.addListener('appStateChange', ({ isActive }) => {
      appActiveRef.current = isActive
      resetIslandSyncKey()
      if (isActive) {
        // 回前台立刻校准并恢复轮询
        void tick()
        startPolling()
      } else {
        // 挂起前再推一次最新态，随后停轮询；由原生标「同步暂停」保留岛
        stopPolling()
        void tick()
      }
    }).then((h) => {
      appHandle = h
    })

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        appActiveRef.current = false
        stopPolling()
        resetIslandSyncKey()
        void tick()
      } else if (document.visibilityState === 'visible') {
        appActiveRef.current = true
        resetIslandSyncKey()
        void tick()
        startPolling()
      }
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
