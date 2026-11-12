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

/** Format host uptime seconds → "2天 3小时" */
export function formatUptime(sec: number | undefined | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—'
  const s = Math.floor(sec)
  if (s < 60) return `${s}秒`
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}天 ${hours}小时` : `${days}天`
  if (hours > 0) return mins > 0 ? `${hours}小时 ${mins}分` : `${hours}小时`
  return `${mins}分`
}

/** Compact duration for card subtitle (no spaces): "11天5小时" */
export function formatDurationCompact(sec: number | undefined | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return ''
  const s = Math.floor(sec)
  if (s < 60) return `${s}秒`
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  if (hours > 0) return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`
  return `${mins}分`
}

/** Normalize host.os → short display label (macOS / Windows / Linux) */
export function hostOsLabel(os: string | undefined | null): string {
  const raw = (os || '').trim()
  if (!raw) return '未知系统'
  const lower = raw.toLowerCase()
  if (lower.includes('darwin') || lower.includes('mac')) return 'macOS'
  if (lower.includes('win')) return 'Windows'
  if (lower.includes('linux')) return 'Linux'
  return raw
}

/** Detect OS family for icon picker */
export function hostOsFamily(os: string | undefined | null): 'mac' | 'windows' | 'linux' | 'other' {
  const lower = (os || '').trim().toLowerCase()
  if (lower.includes('darwin') || lower.includes('mac')) return 'mac'
  if (lower.includes('win')) return 'windows'
  if (lower.includes('linux')) return 'linux'
  return 'other'
}

/** Card subtitle: "macOS · 在线 11天5小时" / "Windows · 离线 8小时" */
export function instanceCardSubtitle(
  inst: PublicInstance,
  now = Date.now(),
): string {
  const online = isInstanceOnline(inst.last_heartbeat_at, now)
  const os = hostOsLabel(inst.host?.os)
  if (online) {
    const up = formatDurationCompact(inst.host?.uptime_sec)
    return up ? `${os} · 在线 ${up}` : `${os} · 在线`
  }
  const hb = inst.last_heartbeat_at
  const ago =
    hb == null ? '' : formatDurationCompact(Math.max(0, Math.floor((now - hb) / 1000)))
  return ago ? `${os} · 离线 ${ago}` : `${os} · 离线`
}

/** Clamp percent for progress bars */
export function formatPct(v: number | undefined | null): number {
  if (v == null || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** Format host temperature for display; missing → "—" */
export function formatTempC(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(Math.round(v * 10) / 10).toFixed(1)}℃`
}

/** Map °C (20–100) to a 0–100 bar width for the instances UI */
export function tempBarPct(v: number | undefined | null): number {
  if (v == null || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(((v - 20) / 80) * 100)))
}
