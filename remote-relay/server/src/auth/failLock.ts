/** After max consecutive failures, lock key for lockMs */
export class FailLockLimiter {
  private readonly state = new Map<
    string,
    { failures: number; lockedUntil: number }
  >()

  constructor(
    private readonly maxFailures: number,
    private readonly lockMs: number,
  ) {}

  /** True when key is still locked */
  isLocked(key: string, now = Date.now()): boolean {
    const row = this.state.get(key)
    if (!row) return false
    if (row.lockedUntil > now) return true
    if (row.lockedUntil > 0 && row.lockedUntil <= now) {
      this.state.delete(key)
    }
    return false
  }

  /** Milliseconds remaining on lock (0 if not locked) */
  lockRemainingMs(key: string, now = Date.now()): number {
    const row = this.state.get(key)
    if (!row || row.lockedUntil <= now) return 0
    return row.lockedUntil - now
  }

  /** Record a failure; returns whether now locked */
  recordFailure(key: string, now = Date.now()): boolean {
    if (this.isLocked(key, now)) return true
    const row = this.state.get(key) ?? { failures: 0, lockedUntil: 0 }
    row.failures += 1
    if (row.failures >= this.maxFailures) {
      row.lockedUntil = now + this.lockMs
      row.failures = 0
      this.state.set(key, row)
      return true
    }
    this.state.set(key, row)
    return false
  }

  /** Clear failures after success */
  reset(key: string): void {
    this.state.delete(key)
  }

  /** Test helper */
  clearAll(): void {
    this.state.clear()
  }
}
