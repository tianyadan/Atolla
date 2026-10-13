import type { PublicInstance } from '../api'

/** Instance considered online when heartbeat within 30s */
export const ONLINE_THRESHOLD_MS = 30_000

/** Whether instance heartbeat is recent enough to show as online */
export function isInstanceOnline(lastHeartbeatAt: number | null, now = Date.now()): boolean {
  if (lastHeartbeatAt == null) return false
  return now - lastHeartbeatAt < ONLINE_THRESHOLD_MS
}

/** Password expiry warning when within 24h or already expired */
export function passwordExpiryHint(
  passwordExpiresAt: number | null,
  now = Date.now(),
): 'expired' | 'soon' | null {
  if (passwordExpiresAt == null) return null
  if (passwordExpiresAt <= now) return 'expired'
  if (passwordExpiresAt - now < 24 * 60 * 60 * 1000) return 'soon'
  return null
}

/** Short label for instance row subtitle */
export function instanceSubtitle(inst: PublicInstance, now = Date.now()): string {
  const online = isInstanceOnline(inst.last_heartbeat_at, now)
  const parts = [online ? '在线' : '离线', inst.status]
  const pwd = passwordExpiryHint(inst.password_expires_at, now)
  if (pwd === 'expired') parts.push('密码已过期')
  else if (pwd === 'soon') parts.push('密码即将过期')
  return parts.join(' · ')
}
