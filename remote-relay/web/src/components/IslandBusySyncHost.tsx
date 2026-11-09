import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchAgents, fetchPendingInstancePermissions, getUnlockToken } from '../api'
import { buildIslandEvents, selectIslandPresentation } from '../islandEvents'
import { resetIslandSyncKey, syncIslandPresentation } from '../islandLiveActivity'
import { subscribeIslandSyncInvalidation } from '../islandSyncInvalidation'

const POLL_MS_FG = 3_000
const POLL_MS_BG = 5_000

/** 原生 5s 唤醒 JS 拉数（展开岛 / 锁屏期间） */
type IslandRefreshPlugin = {
  addListener(
    eventName: 'refreshNeeded',
    listener: (data: { ts?: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

const AtollaIslandRefresh = registerPlugin<IslandRefreshPlugin>('AtollaIsland')

/**
 * 全局轮询忙碌数字人并上岛。
 * 前台 3s；后台/锁屏 5s 继续拉数（配合原生 background task + refreshNeeded）。
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

    /** 启停轮询；后台用 5s，前台 3s */
    function startPolling(ms: number) {
      stopPolling()
      if (cancelled) return
      intervalRef.current = window.setInterval(() => {
        void tick()
      }, ms)
    }

    function stopPolling() {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    void tick()
    startPolling(POLL_MS_FG)

    const invalidate = () => {
      resetIslandSyncKey()
      void tick()
    }
    const unsubscribeInvalidation = subscribeIslandSyncInvalidation(invalidate)

    let appHandle: { remove: () => Promise<void> } | undefined
    void App.addListener('appStateChange', ({ isActive }) => {
      appActiveRef.current = isActive
      resetIslandSyncKey()
      if (isActive) {
        void tick()
        startPolling(POLL_MS_FG)
      } else {
        // 进后台：5s 继续刷新步骤/进度，供展开岛与锁屏更新
        void tick()
        startPolling(POLL_MS_BG)
      }
    }).then((h) => {
      appHandle = h
    })

    // 原生 5s 心跳：WebView 定时器被节流时仍能唤醒拉数
    let refreshHandle: { remove: () => Promise<void> } | undefined
    void AtollaIslandRefresh.addListener('refreshNeeded', () => {
      resetIslandSyncKey()
      void tick()
    }).then((h) => {
      refreshHandle = h
    })

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        appActiveRef.current = false
        resetIslandSyncKey()
        void tick()
        startPolling(POLL_MS_BG)
      } else if (document.visibilityState === 'visible') {
        appActiveRef.current = true
        resetIslandSyncKey()
        void tick()
        startPolling(POLL_MS_FG)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stopPolling()
      unsubscribeInvalidation()
      void appHandle?.remove()
      void refreshHandle?.remove()
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
