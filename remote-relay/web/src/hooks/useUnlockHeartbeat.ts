import { useEffect } from 'react'
import { clearUnlockToken, heartbeatUnlockSession } from '../api'

const INTERVAL_MS = 30_000

/**
 * While an unlocked instance page is visible, ping server so PC shows green online.
 * On 403, clear local unlock so next enter asks for password again.
 */
export function useUnlockHeartbeat(instanceId: string | undefined): void {
  useEffect(() => {
    if (!instanceId) return

    let cancelled = false
    let timer: number | undefined

    async function tick() {
      if (cancelled || document.visibilityState === 'hidden') return
      try {
        await heartbeatUnlockSession(instanceId!)
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 403) {
          clearUnlockToken(instanceId!)
        }
      }
    }

    void tick()
    timer = window.setInterval(() => void tick(), INTERVAL_MS)

    function onVis() {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      if (timer != null) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [instanceId])
}
