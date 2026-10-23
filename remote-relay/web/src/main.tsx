import { Capacitor } from '@capacitor/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { forceHideNativeSplash, hideNativeSplashOnce } from './components/SplashOverlay'
import './index.css'
import { initNativeShell } from './nativeShell'
import { initTheme } from './utils/theme'

// Apply persisted theme before first paint of React tree
initTheme()
void initNativeShell()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * P0 兜底：launchAutoHide 关闭时，原生 hide 失败会永久卡在 LaunchScreen。
 * 多重重试 + 最终拆掉 React SplashOverlay。
 */
function armNativeSplashFailsafe(): void {
  if (!Capacitor.isNativePlatform()) return
  // 首帧后立即尝试
  requestAnimationFrame(() => {
    void hideNativeSplashOnce(true)
  })
  window.setTimeout(() => void hideNativeSplashOnce(true), 600)
  window.setTimeout(() => void hideNativeSplashOnce(true), 1500)
  // 最终兜底：强制结束 React 层 + 再 hide
  window.setTimeout(() => forceHideNativeSplash(), 2800)
}

armNativeSplashFailsafe()
