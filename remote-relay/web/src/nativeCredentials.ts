import { Capacitor, registerPlugin } from '@capacitor/core'

type NativeCredentialPlugin = {
  saveRelayAPIBase(options: { value: string }): Promise<{ ok: boolean }>
  saveSiteToken(options: { token: string }): Promise<{ ok: boolean }>
  saveUnlockToken(options: { instanceId: string; token: string }): Promise<{ ok: boolean }>
  saveRecentInstance(options: { instanceId: string }): Promise<{ ok: boolean }>
  clearSiteSession(): Promise<{ ok: boolean }>
  clearUnlockToken(options: { instanceId: string }): Promise<{ ok: boolean }>
  clearAllUnlockTokens(): Promise<{ ok: boolean }>
  saveLanConnection(options: { instanceId: string; baseUrl: string; deviceId: string; deviceSecret: string; strategy: string }): Promise<{ ok: boolean }>
  loadLanConnection(options: { instanceId: string }): Promise<{ found: boolean; instanceId?: string; baseUrl?: string; deviceId?: string; deviceSecret?: string; strategy?: string }>
  clearLanConnection(options: { instanceId: string }): Promise<{ ok: boolean }>
  discoverLanRelays(): Promise<{ services: Array<{ endpoint: string }> }>
  scanLanPairingQRCode(): Promise<{ payload?: string; cancelled?: boolean }>
  cancelLanPairingQRCode(): Promise<{ ok: boolean }>
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

export function syncNativeLanConnection(value: { instanceId: string; baseUrl: string; deviceId: string; deviceSecret: string; strategy: string }): Promise<void> {
  return runNative(() => NativeCredentials.saveLanConnection(value))
}

export async function loadNativeLanConnection(instanceId: string) {
  if (!Capacitor.isNativePlatform()) return { found: false }
  try { return await NativeCredentials.loadLanConnection({ instanceId }) } catch (error) { console.error('[credentials] Keychain LAN load failed', error); return { found: false } }
}

export function clearNativeLanConnection(instanceId: string): Promise<void> {
  return runNative(() => NativeCredentials.clearLanConnection({ instanceId }))
}

export async function discoverNativeLanRelays(): Promise<Array<{ endpoint: string }>> {
  if (!Capacitor.isNativePlatform()) return []
  try { return (await NativeCredentials.discoverLanRelays()).services } catch (error) { console.error('[credentials] Bonjour discovery failed', error); return [] }
}

export async function scanNativeLanPairingQRCode(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) throw new Error('二维码扫描仅在 iPhone App 中可用')
  const result = await NativeCredentials.scanLanPairingQRCode()
  return result.cancelled ? null : result.payload || null
}
