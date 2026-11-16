import { clearLanConnection, getLanConnection } from './lanConnection'

const CONNECTION_SESSION_KEY = 'atolla_connection_session_v1'

export type ConnectionSession = {
  mode: 'lan'
  instanceId: string
}

/**
 * The session is only a routing convenience. It contains no pairing secret
 * and is never treated as authorization by the Mac; every LAN request still
 * carries an independently verified HMAC envelope.
 */
export function getConnectionSession(): ConnectionSession | null {
  try {
    const raw = localStorage.getItem(CONNECTION_SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ConnectionSession>
    if (value.mode !== 'lan' || !String(value.instanceId || '').trim()) return null
    const session = { mode: 'lan' as const, instanceId: String(value.instanceId).trim() }
    if (!hasCompleteLanPairing(session.instanceId)) {
      clearConnectionSession()
      return null
    }
    return session
  } catch {
    return null
  }
}

/** Starts a local-only session after the QR pairing and health check succeed. */
export function startLanConnectionSession(instanceId: string): void {
  const normalizedInstanceId = String(instanceId || '').trim()
  if (!normalizedInstanceId || !hasCompleteLanPairing(normalizedInstanceId)) {
    throw new Error('局域网配对信息不完整，无法进入实例')
  }
  localStorage.setItem(
    CONNECTION_SESSION_KEY,
    JSON.stringify({ mode: 'lan', instanceId: normalizedInstanceId } satisfies ConnectionSession),
  )
}

export function clearConnectionSession(): void {
  try {
    localStorage.removeItem(CONNECTION_SESSION_KEY)
  } catch {
    // Storage access may be blocked in a private browser context.
  }
}

/**
 * A revoked device key is different from a temporary network failure. Keeping
 * it would let the login route treat the stale QR session as authenticated and
 * bounce the user back into a page that immediately receives 401 again.
 */
export function invalidateRevokedLanSession(instanceId: string): void {
  const normalizedInstanceId = String(instanceId || '').trim()
  if (normalizedInstanceId) clearLanConnection(normalizedInstanceId)
  clearConnectionSession()
}

/** Remote JWT or a still-paired LAN session may pass the client route guard. */
export function hasAuthenticatedConnection(remoteToken: string | null | undefined): boolean {
  return !!remoteToken || !!getConnectionSession()
}

/** A LAN pairing grants entry only to the QR-bound instance, never all Macs. */
export function hasLanInstanceAccess(instanceId: string): boolean {
  const session = getConnectionSession()
  return !!session && session.instanceId === String(instanceId || '').trim()
}

function hasCompleteLanPairing(instanceId: string): boolean {
  const connection = getLanConnection(instanceId)
  return !!(
    connection.instanceId === instanceId &&
    connection.baseUrl &&
    connection.deviceId &&
    connection.deviceSecret
  )
}
