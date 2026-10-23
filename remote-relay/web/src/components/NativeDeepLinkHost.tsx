import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getToken, hasUnlockToken } from '../api'
import {
  clearPendingDeepLink,
  isDeepLinkPathActive,
  navigateToDeepLinkChat,
  parseAtollaDeepLink,
  savePendingDeepLink,
  type AtollaDeepLinkTarget,
} from '../utils/deepLink'

/** 冷启动 launch URL 只处理一次，避免 effect 重跑时再次 navigate 把「返回」打回对话页 */
let launchUrlConsumed = false

/** 测试或热重载时可重置 launch 消费标记 */
export function resetLaunchUrlConsumedForTests(): void {
  launchUrlConsumed = false
}

/** 接收 Widget/灵动岛 URL；认证或解锁不足时先持久化目标再恢复。 */
export function NativeDeepLinkHost() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location)
  locationRef.current = location

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false

    const openTarget = (target: AtollaDeepLinkTarget) => {
      if (cancelled) return
      const current = locationRef.current
      if (isDeepLinkPathActive(target, current.pathname, current.search)) {
        clearPendingDeepLink()
        return
      }
      savePendingDeepLink(target)
      if (!getToken()) {
        navigate('/login')
        return
      }
      if (!hasUnlockToken(target.instanceId)) {
        navigate(`/instances?unlock=${encodeURIComponent(target.instanceId)}`)
        return
      }
      navigateToDeepLinkChat(navigate, target, current)
    }

    const openUrl = (url: string | undefined) => {
      if (cancelled || !url) return
      const target = parseAtollaDeepLink(url)
      if (target) openTarget(target)
    }

    let listener: { remove: () => Promise<void> } | undefined
    void CapacitorApp.addListener('appUrlOpen', ({ url }) => openUrl(url)).then((handle) => {
      listener = handle
    })
    if (!launchUrlConsumed) {
      launchUrlConsumed = true
      void CapacitorApp.getLaunchUrl().then((result) => {
        if (!cancelled) openUrl(result?.url)
      })
    }

    return () => {
      cancelled = true
      void listener?.remove()
    }
  }, [navigate])

  return null
}
