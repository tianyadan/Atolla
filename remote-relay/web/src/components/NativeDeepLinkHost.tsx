import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken, hasUnlockToken } from '../api'
import {
  clearPendingDeepLink,
  deepLinkTargetPath,
  parseAtollaDeepLink,
  savePendingDeepLink,
  type AtollaDeepLinkTarget,
} from '../utils/deepLink'

/** 接收 Widget/灵动岛 URL；认证或解锁不足时先持久化目标再恢复。 */
export function NativeDeepLinkHost() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false

    const openTarget = (target: AtollaDeepLinkTarget) => {
      savePendingDeepLink(target)
      if (!getToken()) {
        navigate('/login')
        return
      }
      if (!hasUnlockToken(target.instanceId)) {
        navigate(`/instances?unlock=${encodeURIComponent(target.instanceId)}`)
        return
      }
      clearPendingDeepLink()
      navigate(deepLinkTargetPath(target))
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
    void CapacitorApp.getLaunchUrl().then((result) => openUrl(result?.url))

    return () => {
      cancelled = true
      void listener?.remove()
    }
  }, [navigate])

  return null
}
