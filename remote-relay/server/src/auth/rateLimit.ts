/** Per-IP login attempt window (ms) and max attempts before throttle */
const WINDOW_MS = 60_000
const MAX_ATTEMPTS_PER_WINDOW = 5

type IpWindow = { timestamps: number[] }

/** In-memory IP rate limiter for login endpoints */
export class LoginRateLimiter {
  private readonly windows = new Map<string, IpWindow>()

  /** True when key already hit max attempts in the window (does not record) */
  isThrottled(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key)
    if (!window) return false
    const cutoff = now - WINDOW_MS
    const active = window.timestamps.filter((t) => t > cutoff)
    return active.length >= MAX_ATTEMPTS_PER_WINDOW
  }

  /** Record an attempt; returns false when IP exceeds attempts per minute */
  recordAttempt(ip: string, now = Date.now()): boolean {
    const window = this.windows.get(ip) ?? { timestamps: [] }
    const cutoff = now - WINDOW_MS
    window.timestamps = window.timestamps.filter((t) => t > cutoff)
    if (window.timestamps.length >= MAX_ATTEMPTS_PER_WINDOW) {
      this.windows.set(ip, window)
      return false
    }
    window.timestamps.push(now)
    this.windows.set(ip, window)
    return true
  }

  /** Clear state (for isolated tests) */
  reset(): void {
    this.windows.clear()
  }
}
