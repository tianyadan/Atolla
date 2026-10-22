import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchAgents, getUnlockToken } from '../api'
import { resetIslandSyncKey, syncIslandFromAgents } from '../islandLiveActivity'

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
  instanceRef.current = instanceId

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return
    if (!instanceId || !getUnlockToken(instanceId)) return

    resetIslandSyncKey()
    let cancelled = false
    const gen = ++genRef.current

    async function tick() {
      const id = instanceRef.current
      if (cancelled || gen !== genRef.current || !id) return
      try {
        const agents = await fetchAgents(id)
        if (cancelled || gen !== genRef.current) return
        await syncIslandFromAgents(agents)
      } catch {
        /* 未解锁 / 网络：下轮重试 */
      }
    }

    void tick()
    const intervalId = window.setInterval(() => void tick(), POLL_MS)

    // 切到后台立刻上岛（等轮询会错过）
    let appHandle: { remove: () => Promise<void> } | undefined
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        resetIslandSyncKey()
        void tick()
      }
    }).then((h) => {
      appHandle = h
    })

    // 页面被系统挂起前再推一次
    const onHide = () => {
      resetIslandSyncKey()
      void tick()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      void appHandle?.remove()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
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
