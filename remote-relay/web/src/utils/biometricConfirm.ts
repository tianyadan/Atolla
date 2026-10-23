import { Capacitor } from '@capacitor/core'
import { BiometricAuth, BiometryError } from '@aparajita/capacitor-biometric-auth'

/**
 * 发送验证码前确认。
 * App：Face ID / 设备密码（Native Biometric）；取消则中止。
 * Web：window.confirm。
 */
export async function confirmSendUnlockOtp(maskedEmail: string): Promise<boolean> {
  const hint = maskedEmail
    ? `将向 ${maskedEmail} 发送一次性解锁验证码`
    : '将向已配置的接收邮箱发送一次性解锁验证码'

  if (Capacitor.isNativePlatform()) {
    try {
      const info = await BiometricAuth.checkBiometry()
      if (info.isAvailable || info.deviceIsSecure) {
        await BiometricAuth.authenticate({
          reason: hint,
          cancelTitle: '取消',
          allowDeviceCredential: true,
          iosFallbackTitle: '使用密码',
        })
        return true
      }
    } catch (err) {
      // 用户取消或校验失败 → 不发码
      if (err instanceof BiometryError) return false
      if (err && typeof err === 'object' && 'code' in err) return false
      // 插件异常时回退确认框
    }
  }

  return typeof window !== 'undefined' ? window.confirm(`${hint}，确认继续？`) : false
}
