import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { getToken, getUnlockToken } from '../api'
import {
  syncNativeRelayAPIBase,
  syncNativeRecentInstance,
  syncNativeSiteToken,
  syncNativeUnlockToken,
} from '../nativeCredentials'
import { getApiBase } from '../utils/apiBase'

/** 从实例路由同步最近访问实例，供 Siri 默认选择使用。 */
export function NativeCredentialSyncHost() {
  const location = useLocation()

  useEffect(() => {
    const apiBase = getApiBase()
    const siteToken = getToken()
    void syncNativeRelayAPIBase(apiBase)
    if (siteToken) void syncNativeSiteToken(siteToken)
  }, [])

  useEffect(() => {
    const match = /^\/instances\/([^/]+)/.exec(location.pathname)
    if (!match) return
    try {
      const instanceId = decodeURIComponent(match[1])
      const unlockToken = getUnlockToken(instanceId)
      void syncNativeRecentInstance(instanceId)
      if (unlockToken) void syncNativeUnlockToken(instanceId, unlockToken)
    } catch {
      // 非法路由片段不应影响页面导航。
    }
  }, [location.pathname])

  return null
}
