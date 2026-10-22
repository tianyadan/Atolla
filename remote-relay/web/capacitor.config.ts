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
    backgroundColor: '#09090b',
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
      launchAutoHide: true,
      backgroundColor: '#09090b',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
    },
    Keyboard: {
      // none + JS 监听键盘高度，避免全面屏下输入框被挡
      resize: 'none',
      resizeOnFullScreen: true,
    },
  },
}

export default config
