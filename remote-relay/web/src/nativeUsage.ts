import { Capacitor, registerPlugin } from '@capacitor/core'
import type { EnginesUsageResponse } from './utils/engineUsage'

type NativeUsagePlugin = {
  publishEnginesUsage(options: {
    usage: EnginesUsageResponse
    instanceId?: string
  }): Promise<{ ok: boolean; engines?: number }>
  reloadWidgets(): Promise<{ ok: boolean }>
}

const NativeUsage = registerPlugin<NativeUsagePlugin>('AtollaUsage')

/** 仅 iOS 壳：把用量快照推到 App Group / 桌面小组件。 */
export async function publishNativeEnginesUsage(
  usage: EnginesUsageResponse,
  instanceId?: string,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await NativeUsage.publishEnginesUsage({
      usage,
      instanceId: instanceId || undefined,
    })
  } catch (error) {
    console.error('[usage] widget snapshot sync failed', error)
  }
}
