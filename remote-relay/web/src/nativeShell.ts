import { Capacitor } from '@capacitor/core'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { StatusBar, Style } from '@capacitor/status-bar'

/**
 * Capacitor 原生壳启动：全面屏沉浸、状态栏叠层、键盘顶起。
 * 仅在 iOS/Android 原生环境执行；浏览器里 no-op。
 * 灵动岛由 IslandBusySyncHost 全局轮询驱动，此处不 endAll，避免与忙碌同步竞态。
 */
export async function initNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  document.documentElement.classList.add('native-app')

  try {
    const dark =
      document.documentElement.classList.contains('theme-dark') ||
      (!document.documentElement.classList.contains('theme-light') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    // overlay=true：内容铺到状态栏下方，配合 safe-area 做全面屏
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.show()
  } catch {
    /* 模拟器/旧版忽略 */
  }

  try {
    // None：不改 WebView 高度，由对话页用 keyboard 高度垫高输入框（Body 模式在全面屏下常顶不起）
    await Keyboard.setResizeMode({ mode: KeyboardResize.None })
  } catch {
    /* ignore */
  }
}
