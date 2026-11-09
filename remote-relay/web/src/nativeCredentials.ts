import { Capacitor, registerPlugin } from '@capacitor/core'

type NativeCredentialPlugin = {
  saveRelayAPIBase(options: { value: string }): Promise<{ ok: boolean }>
  saveSiteToken(options: { token: string }): Promise<{ ok: boolean }>
  saveUnlockToken(options: { instanceId: string; token: string }): Promise<{ ok: boolean }>
  saveRecentInstance(options: { instanceId: string }): Promise<{ ok: boolean }>
  clearSiteSession(): Promise<{ ok: boolean }>
  clearUnlockToken(options: { instanceId: string }): Promise<{ ok: boolean }>
  clearAllUnlockTokens(): Promise<{ ok: boolean }>
}

const NativeCredentials = registerPlugin<NativeCredentialPlugin>('AtollaCredentials')

/** 浏览器环境保持原有 localStorage 行为，只有 iOS 原生壳写入 Keychain。 */
async function runNative(operation: () => Promise<unknown>): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await operation()
  } catch (error) {
    // Keychain 镜像失败不能阻断当前 Web 会话，但必须留下诊断信息。
    console.error('[credentials] Keychain sync failed', error)
  }
}

export function syncNativeRelayAPIBase(value: string): Promise<void> {
  return runNative(() => NativeCredentials.saveRelayAPIBase({ value }))
}

export function syncNativeSiteToken(token: string): Promise<void> {
  return runNative(() => NativeCredentials.saveSiteToken({ token }))
}

export function syncNativeUnlockToken(instanceId: string, token: string): Promise<void> {
  return runNative(() => NativeCredentials.saveUnlockToken({ instanceId, token }))
}

export function syncNativeRecentInstance(instanceId: string): Promise<void> {
  return runNative(() => NativeCredentials.saveRecentInstance({ instanceId }))
}

export function clearNativeSiteSession(): Promise<void> {
  return runNative(() => NativeCredentials.clearSiteSession())
}

export function clearNativeUnlockToken(instanceId: string): Promise<void> {
  return runNative(() => NativeCredentials.clearUnlockToken({ instanceId }))
}

export function clearAllNativeUnlockTokens(): Promise<void> {
  return runNative(() => NativeCredentials.clearAllUnlockTokens())
}
