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
 * 必须挂在已登录布局里；聊天页 / 切后台也要同步（不能只靠 Agents 列表页）。
 */
export function IslandBusySyncHost() {
  const location = useLocation()
  const instanceId = parseInstanceId(location.pathname)
  const genRef = useRef(0)
  const instanceRef = useRef(instanceId)

  useEffect(() => {
    instanceRef.current = instanceId
  }, [instanceId])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return

    // 离开实例或未解锁：立刻下岛，避免停轮询后锁屏残留
    if (!instanceId || !getUnlockToken(instanceId)) {
      resetIslandSyncKey()
      void syncIslandPresentation({ activeKind: null, count: 0, items: [] })
      return
    }

    resetIslandSyncKey()
    let cancelled = false
    const gen = ++genRef.current

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
        await syncIslandPresentation(selectIslandPresentation(events))
      } catch {
        /* 未解锁 / 网络：下轮重试 */
      }
    }

    void tick()
    const intervalId = window.setInterval(() => void tick(), POLL_MS)

    const invalidate = () => void tick()
    const unsubscribeInvalidation = subscribeIslandSyncInvalidation(invalidate)

    // 前后台切换都立即校准；挂起后由原生延迟 dismiss，回前台再重建。
    let appHandle: { remove: () => Promise<void> } | undefined
    void App.addListener('appStateChange', () => {
      resetIslandSyncKey()
      void tick()
    }).then((h) => {
      appHandle = h
    })

    // 挂起前再推一次，供原生写入最新态后预约下岛
    const onHide = () => {
      resetIslandSyncKey()
      void tick()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      unsubscribeInvalidation()
      void appHandle?.remove()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      void syncIslandPresentation({ activeKind: null, count: 0, items: [] })
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
