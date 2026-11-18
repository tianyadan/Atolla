const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

/**
 * 把后端任务开始时间统一为毫秒时间戳。
 * 兼容旧版 SQLite 把本地墙上时间当 UTC 返回、导致开始时间落在未来的历史数据。
 */
export function taskStartedAtMs(value, nowMs = Date.now(), timezoneOffsetMinutes) {
  if (value == null || value === '') return 0
  const numeric = Number(value)
  let startedAt = Number.isFinite(numeric)
    ? (numeric < 1e12 ? numeric * 1000 : numeric)
    : Date.parse(String(value))
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0

  if (startedAt > nowMs + FUTURE_TOLERANCE_MS) {
    const offset = timezoneOffsetMinutes ?? new Date(startedAt).getTimezoneOffset()
    const corrected = startedAt + offset * 60 * 1000
    // 只接受比原值更接近当前时刻的时区纠偏，避免改写真实的未来时间。
    if (corrected > 0 && Math.abs(nowMs - corrected) < Math.abs(nowMs - startedAt)) {
      startedAt = corrected
    }
  }
  return startedAt
}
export function runningElapsedSec(value, nowMs = Date.now(), timezoneOffsetMinutes) {
  const startedAt = taskStartedAtMs(value, nowMs, timezoneOffsetMinutes)
  if (!startedAt) return 0
  return Math.max(0, Math.round((nowMs - startedAt) / 1000))
}
