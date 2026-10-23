import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { useEffect, useState } from 'react'
import { restoreStatusBarForTheme } from '../nativeShell'

type Phase = 'idle' | 'logo' | 'text' | 'hold' | 'out' | 'done'

/** 是否原生壳（每次调用时检测，避免模块加载过早误判） */
function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** 模块级状态：跨 StrictMode remount，且后台恢复不重播 */
const splashRuntime = {
  phase: 'idle' as Phase,
  nativeHidden: false,
  started: false,
  listeners: new Set<(p: Phase) => void>(),
}

/** 广播 phase 给当前挂载的 Overlay */
function setSplashPhase(phase: Phase): void {
  splashRuntime.phase = phase
  for (const fn of splashRuntime.listeners) fn(phase)
}

/** 带超时的 Promise，防止原生桥挂死 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms)
    }),
  ])
}

/**
 * 隐藏 Capacitor 原生启动遮罩。
 * 不依赖动画开关；失败可重试（force 时重置标记）。
 */
export async function hideNativeSplashOnce(force = false): Promise<void> {
  if (!isNativeShell()) return
  if (splashRuntime.nativeHidden && !force) return
  try {
    await withTimeout(SplashScreen.hide({ fadeOutDuration: 0 }), 800)
    splashRuntime.nativeHidden = true
  } catch {
    /* 插件未就绪：不置 nativeHidden，允许兜底重试 */
  }
}

/** 启动失败 / 卡住时的全局兜底：摘原生遮罩并拆掉 React 层 */
export function forceHideNativeSplash(): void {
  void hideNativeSplashOnce(true)
  if (splashRuntime.phase !== 'done') {
    setSplashPhase('done')
    void restoreStatusBarForTheme()
  }
}

/** 启动模块级动画（只跑一次；hide 带超时，绝不永久阻塞） */
function ensureSplashSequence(): void {
  if (!isNativeShell() || splashRuntime.started) return
  splashRuntime.started = true

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

  void (async () => {
    // 立刻尝试摘原生屏，再画 React 白底动画（原生挂起也不能挡住）
    await hideNativeSplashOnce()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    try {
      await withTimeout(StatusBar.setStyle({ style: Style.Light }), 500)
    } catch {
      /* ignore */
    }
    // 再藏一次，防止首次桥未就绪
    await hideNativeSplashOnce(true)

    if (reducedMotion) {
      setSplashPhase('logo')
      await wait(120)
      setSplashPhase('text')
      await wait(180)
      setSplashPhase('out')
      await wait(200)
      setSplashPhase('done')
      await hideNativeSplashOnce(true)
      await restoreStatusBarForTheme()
      return
    }

    // ~1.5s：logo 400 → text 400 → hold 400 → fade 300
    setSplashPhase('logo')
    await wait(400)
    setSplashPhase('text')
    await wait(400)
    setSplashPhase('hold')
    await wait(400)
    setSplashPhase('out')
    await wait(300)
    setSplashPhase('done')
    await hideNativeSplashOnce(true)
    await restoreStatusBarForTheme()
  })()
}

/**
 * 冷启动白底欢迎层：Logo → 文案上浮 → 淡出。
 * 非原生壳不渲染；原生壳必跑，且有 main 侧多重 hide 兜底。
 */
export function SplashOverlay() {
  const native = isNativeShell()
  const [phase, setPhase] = useState<Phase>(() =>
    native ? splashRuntime.phase : 'done',
  )

  useEffect(() => {
    if (!isNativeShell()) {
      // 即便误判过，挂载后仍强制尝试 hide（无副作用于 Web）
      void hideNativeSplashOnce(true)
      return
    }
    const onPhase = (p: Phase) => setPhase(p)
    splashRuntime.listeners.add(onPhase)
    setPhase(splashRuntime.phase)
    ensureSplashSequence()
    return () => {
      splashRuntime.listeners.delete(onPhase)
    }
  }, [])

  if (!native || phase === 'done') return null

  const logoIn = phase === 'logo' || phase === 'text' || phase === 'hold' || phase === 'out'
  const textIn = phase === 'text' || phase === 'hold' || phase === 'out'
  const fading = phase === 'out'

  return (
    <div
      className={`splash-overlay${fading ? ' splash-overlay--out' : ''}`}
      role="presentation"
      aria-hidden
    >
      <div className={`splash-logo${logoIn ? ' is-in' : ''}`}>
        <img src="/brand-jellyfish.png" alt="" width={120} height={120} draggable={false} />
      </div>
      <div className={`splash-copy${textIn ? ' is-in' : ''}`}>
        <p className="splash-title">Atolla</p>
        <p className="splash-tagline">Your AI Workforce</p>
      </div>
    </div>
  )
}
