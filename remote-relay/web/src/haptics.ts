import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

/**
 * iOS 轻触反馈（类似 ChatGPT 点击感）。
 * 仅原生壳生效；Web / 失败时静默忽略。
 */
export function tapHaptic(): void {
  if (!Capacitor.isNativePlatform()) return
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
    /* 模拟器或未链原生插件时忽略 */
  })
}
