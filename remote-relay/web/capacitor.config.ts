import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Atolla 移动端 Capacitor 壳（不上架也可真机安装）。
 * webDir 指向 Vite 产物；API 走设置页 / VITE_API_BASE，不依赖同源代理。
 */
const config: CapacitorConfig = {
  appId: 'com.atolla.relay',
  appName: 'Atolla',
  webDir: 'dist',
  ios: {
    // never：WebView 铺满屏幕，由 CSS safe-area 自己避让刘海/Home 条
    contentInset: 'never',
    preferredContentMode: 'mobile',
    // 冷启动白底：与 LaunchScreen / SplashOverlay 一致，避免首帧露深色
    backgroundColor: '#FFFFFF',
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    // 允许 App 内跳到中继域名（登录后的绝对 API）
    allowNavigation: ['*'],
  },
  plugins: {
    // 原生 URLSession 发请求，绕过 WKWebView「https 页请求 http」混合内容拦截
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      // true + 时长兜底：即使 JS hide 失败也不会永久卡在 LaunchScreen
      // React 就绪后仍会立刻 SplashScreen.hide() 做无缝衔接
      launchAutoHide: true,
      launchShowDuration: 2500,
      backgroundColor: '#FFFFFF',
      showSpinner: false,
    },
    StatusBar: {
      // LIGHT = 深色图标/文字，适配白色启动屏（@capacitor/status-bar Style.Light）
      style: 'LIGHT',
    },
    Keyboard: {
      // none + JS 监听键盘高度，避免全面屏下输入框被挡
      resize: 'none',
      resizeOnFullScreen: true,
    },
  },
}

export default config
