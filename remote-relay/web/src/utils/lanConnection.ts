import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { clearNativeLanConnection, syncNativeLanConnection } from '../nativeCredentials'

const STORAGE_KEY = 'atolla_lan_connection_v1'
const ROUTE_STATE_KEY = 'atolla_lan_route_state_v1'
const CLIENT_KEY_STORAGE = 'atolla_lan_client_key_v1'
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const LAN_IMAGE_URL_LIFETIME_SECONDS = 5 * 60

export type LanConnection = {
  /** A pairing belongs to exactly one Mac instance; never reuse its key for another instance. */
  instanceId?: string
  baseUrl: string
  deviceId: string
  deviceSecret: string
  strategy: 'auto' | 'lan_only' | 'cloud_only'
}

export const defaultLanConnection: LanConnection = {
  baseUrl: '',
  deviceId: '',
  deviceSecret: '',
  strategy: 'auto',
}

export type LanRouteState = {
  channel: 'lan' | 'cloud' | 'unavailable'
  failureCount: number
  lastSuccessAt?: number
  lastError?: string
}

export type LanActionPhase = 'preflight_failed' | 'dispatched'
export type LanActionRecovery = 'cloud_fallback' | 'outcome_unknown' | 'surface_error'

/**
 * Returns the only safe recovery route for a write. Tencent Cloud currently
 * has no compatible idempotency contract, so replaying a dispatched LAN write
 * there could create a duplicate chat, task, or approval decision.
 */
export function decideLanActionRecovery(input: {
  phase: LanActionPhase
  strategy: LanConnection['strategy']
}): LanActionRecovery {
  if (input.strategy === 'lan_only') return 'surface_error'
  return input.phase === 'preflight_failed' ? 'cloud_fallback' : 'outcome_unknown'
}

/** Indicates that Mac may have executed a write but the App lacks its result. */
export class LanActionOutcomeUnknownError extends Error {
  constructor(message = '局域网动作结果未知；请刷新确认后再重试，系统未自动转发到云端以避免重复执行') {
    super(message)
    this.name = 'LanActionOutcomeUnknownError'
  }
}

/** A pairing was explicitly rejected by Mac, so retrying it cannot recover. */
export class LanAuthorizationError extends Error {
  readonly status: 401 | 403

  constructor(status: 401 | 403) {
    super('局域网配对已被撤销或失效，请重新扫描二维码连接')
    this.name = 'LanAuthorizationError'
    this.status = status
  }
}

function throwForLanAuthorization(status: number): void {
  if (status === 401 || status === 403) throw new LanAuthorizationError(status)
}

type IdempotencyEntry = { key: string; expiresAt: number }

/**
 * Keeps the key for a write whose result was not conclusively received. A
 * manual retry with the same semantic request then reaches Mac's cached
 * result instead of becoming a second execution. Known outcomes are removed
 * immediately so a deliberate later repeat receives a fresh key.
 */
export class LanActionIdempotencyRegistry {
  private readonly entries = new Map<string, IdempotencyEntry>()
  private readonly createKey: () => string
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(
    createKey: () => string = createLanIdempotencyKey,
    now: () => number = () => Date.now(),
    ttlMs = 10 * 60_000,
  ) {
    this.createKey = createKey
    this.now = now
    this.ttlMs = ttlMs
  }

  acquire(fingerprint: string): string {
    this.prune()
    const existing = this.entries.get(fingerprint)
    if (existing) return existing.key
    const key = this.createKey()
    this.entries.set(fingerprint, { key, expiresAt: this.now() + this.ttlMs })
    return key
  }

  keepForUnknownOutcome(fingerprint: string): void {
    const existing = this.entries.get(fingerprint)
    if (existing) existing.expiresAt = this.now() + this.ttlMs
  }

  clearAfterKnownOutcome(fingerprint: string): void {
    this.entries.delete(fingerprint)
  }

  private prune(): void {
    const now = this.now()
    for (const [fingerprint, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(fingerprint)
    }
  }
}

export function createLanIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `lan${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

type LanConnectionStore = { version: 2; connections: Record<string, LanConnection>; legacy?: LanConnection }

function normalizeConnection(value: Partial<LanConnection>): LanConnection {
  return {
    instanceId: String(value.instanceId || '').trim() || undefined,
    baseUrl: normalizeBase(value.baseUrl || ''),
    deviceId: String(value.deviceId || '').trim(),
    deviceSecret: String(value.deviceSecret || '').trim(),
    strategy: value.strategy === 'lan_only' || value.strategy === 'cloud_only' ? value.strategy : 'auto',
  }
}

function getConnectionStore(): LanConnectionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 2, connections: {} }
    const value = JSON.parse(raw) as Partial<LanConnectionStore> & Partial<LanConnection>
    if (value.version === 2 && value.connections) return { version: 2, connections: Object.fromEntries(Object.entries(value.connections).map(([id, connection]) => [id, normalizeConnection({ ...connection, instanceId: id })])) }
    // Read the original single-record shape once so existing paired users do
    // not lose access. It is used only when a request has no instance ID.
    return { version: 2, connections: {}, legacy: normalizeConnection(value) }
  } catch {
    return { version: 2, connections: {} }
  }
}

export function getLanConnection(instanceId?: string): LanConnection {
  const store = getConnectionStore()
  if (instanceId) return store.connections[instanceId] || { ...defaultLanConnection, instanceId }
  return store.legacy || Object.values(store.connections)[0] || { ...defaultLanConnection }
}

/** Returns every complete QR pairing so the instance picker can show all local Macs. */
export function listLanConnections(): LanConnection[] {
  const store = getConnectionStore()
  const values = [...Object.values(store.connections), ...(store.legacy ? [store.legacy] : [])]
  const unique = new Map<string, LanConnection>()
  for (const connection of values) {
    const normalized = normalizeConnection(connection)
    if (!normalized.instanceId || !normalized.baseUrl || !normalized.deviceId || !normalized.deviceSecret) continue
    unique.set(normalized.instanceId, normalized)
  }
  return [...unique.values()]
}

export function saveLanConnection(value: LanConnection): void {
  const normalized = normalizeConnection(value)
  const store = getConnectionStore()
  if (normalized.instanceId) {
    store.connections[normalized.instanceId] = normalized
    void syncNativeLanConnection({ instanceId: normalized.instanceId, baseUrl: normalized.baseUrl, deviceId: normalized.deviceId, deviceSecret: normalized.deviceSecret, strategy: normalized.strategy })
  } else {
    store.legacy = normalized
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function clearLanConnection(instanceId?: string): void {
  if (!instanceId) { localStorage.removeItem(STORAGE_KEY); return }
  const store = getConnectionStore()
  delete store.connections[instanceId]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  void clearNativeLanConnection(instanceId)
}

function getRouteStates(): Record<string, LanRouteState> {
  try { return JSON.parse(localStorage.getItem(ROUTE_STATE_KEY) || '{}') as Record<string, LanRouteState> } catch { return {} }
}

export function getLanRouteState(instanceId: string): LanRouteState {
  return getRouteStates()[instanceId] || { channel: 'cloud', failureCount: 0 }
}

export function recordLanRoute(instanceId: string, state: Omit<LanRouteState, 'failureCount'> & { failureCount?: number }): void {
  if (!instanceId) return
  const states = getRouteStates(); const previous = states[instanceId]
  states[instanceId] = { failureCount: state.failureCount ?? previous?.failureCount ?? 0, ...state }
  localStorage.setItem(ROUTE_STATE_KEY, JSON.stringify(states))
}

export function recordLanFailure(instanceId: string, error: unknown): void {
  if (!instanceId) return
  const previous = getLanRouteState(instanceId)
  recordLanRoute(instanceId, { channel: 'cloud', failureCount: previous.failureCount + 1, lastSuccessAt: previous.lastSuccessAt, lastError: error instanceof Error ? error.message : String(error) })
}

export function normalizeBase(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '')
}

type LanPairingPayload = { version: number; instance_id: string; session_id: string; challenge: string; base_urls: string[]; expires_at: number }

let memoryClientKey = ''

/**
 * Stable per-install identity for LAN pairing. Sending it with every pairing
 * lets Mac refresh the same device card instead of creating a new one each
 * time the user re-scans a QR.
 */
export function getLanClientKey(): string {
  try {
    const existing = localStorage.getItem(CLIENT_KEY_STORAGE)
    if (existing && /^[A-Za-z0-9_-]{16,96}$/.test(existing)) return existing
    const created = createLanIdempotencyKey()
    localStorage.setItem(CLIENT_KEY_STORAGE, created)
    return created
  } catch {
    if (!memoryClientKey) memoryClientKey = createLanIdempotencyKey()
    return memoryClientKey
  }
}

/** Completes a QR flow without ever placing the long-lived secret in the QR.
 * The first Mac address that responds wins; the server atomically consumes
 * the session, so retrying a second address cannot mint another device key. */
export async function completeLanPairing(
  rawPayload: string,
  strategy: LanConnection['strategy'] = 'auto',
): Promise<LanConnection> {
  let payload: LanPairingPayload
  try { payload = JSON.parse(rawPayload) as LanPairingPayload } catch { throw new Error('不是 Atolla 局域网配对二维码') }
  const instanceId = String(payload.instance_id || '').trim()
  if (payload.version !== 1 || !instanceId || !payload.session_id || !payload.challenge || !Array.isArray(payload.base_urls) || payload.expires_at * 1000 <= Date.now()) throw new Error('配对二维码无效、缺少实例信息或已过期')
  const clientKey = getLanClientKey()
  let lastError: unknown
  for (const candidate of payload.base_urls) {
    const baseUrl = normalizeBase(candidate)
    try {
      // Best-effort: tells the Mac that the QR was scanned so the desktop can
      // swap the QR for a progress state while this request completes.
      await unsignedPairAckRequest(baseUrl, payload).catch(() => undefined)
      const response = await unsignedPairRequest(baseUrl, payload, clientKey)
      if (!response.ok || !response.device_id || !response.device_secret) throw new Error('Mac 拒绝该配对请求')
      const connection: LanConnection = { instanceId, baseUrl, deviceId: response.device_id, deviceSecret: response.device_secret, strategy }
      saveLanConnection(connection)
      return connection
    } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('无法连接二维码中的 Mac 地址')
}

async function unsignedPairAckRequest(baseUrl: string, payload: LanPairingPayload): Promise<void> {
  const url = `${baseUrl}/lan/v1/pair/ack`
  const data = { session_id: payload.session_id, challenge: payload.challenge }
  if (Capacitor.isNativePlatform()) {
    await CapacitorHttp.request({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, data, connectTimeout: 3_000, readTimeout: 3_000 })
    return
  }
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}

async function unsignedPairRequest(baseUrl: string, payload: LanPairingPayload, clientKey: string): Promise<{ ok?: boolean; device_id?: string; device_secret?: string }> {
  const url = `${baseUrl}/lan/v1/pair`
  const data = { session_id: payload.session_id, challenge: payload.challenge, client_key: clientKey }
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, data, connectTimeout: 5_000, readTimeout: 10_000 })
    if (response.status !== 200) throw new Error(`配对失败（HTTP ${response.status}）`)
    return response.data as { ok?: boolean; device_id?: string; device_secret?: string }
  }
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  if (!response.ok) throw new Error(`配对失败（HTTP ${response.status}）`)
  return response.json() as Promise<{ ok?: boolean; device_id?: string; device_secret?: string }>
}

/** Signed health request used before any application traffic is routed to LAN. */
export async function checkLanConnection(connection: LanConnection): Promise<void> {
  const baseUrl = normalizeBase(connection.baseUrl)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    throw new Error('请输入 Mac 的 HTTP 地址，例如 http://192.168.1.20:7943')
  }
  if (parsedUrl.protocol !== 'http:' || !parsedUrl.hostname || parsedUrl.pathname !== '/') {
    throw new Error('请输入 Mac 的 HTTP 地址，例如 http://192.168.1.20:7943')
  }
  if (!connection.deviceId.trim() || !connection.deviceSecret.trim()) {
    throw new Error('请填写设备 ID 和配对密钥')
  }
  const path = '/lan/v1/health'
  const timestamp = new Date().toISOString()
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const signature = await hmacSha256(
    connection.deviceSecret.trim(),
    `GET\n${path}\n${timestamp}\n${nonce}\n${EMPTY_BODY_SHA256}`,
  )
  const headers = {
    'X-Atolla-Device': connection.deviceId.trim(),
    'X-Atolla-Timestamp': timestamp,
    'X-Atolla-Nonce': nonce,
    'X-Atolla-Signature': signature,
  }
  const url = `${baseUrl}${path}`
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.request({ url, method: 'GET', headers, connectTimeout: 5_000, readTimeout: 8_000 })
    throwForLanAuthorization(result.status)
    if (result.status !== 200 || !(result.data as { ok?: boolean })?.ok) {
      throw new Error(`Mac 局域网服务不可用（HTTP ${result.status}）`)
    }
    return
  }
  const result = await fetch(url, { headers })
  throwForLanAuthorization(result.status)
  if (!result.ok) throw new Error(`Mac 局域网服务不可用（HTTP ${result.status}）`)
  const payload = (await result.json()) as { ok?: boolean }
  if (!payload.ok) throw new Error('Mac 局域网服务返回异常')
}

/** Invoke one allowlisted local business action using the same signed envelope. */
export async function callLanAction<T>(connection: LanConnection, action: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<T> {
  const body = JSON.stringify({ action, payload })
  let result: { ok: boolean; status: number; data: unknown }
  try {
    result = await signedLanRequest(connection, '/lan/v1/actions', 'POST', body, idempotencyKey)
  } catch {
    throw new LanActionOutcomeUnknownError()
  }
  if (!result.ok) {
    throwForLanAuthorization(result.status)
    if (result.status >= 500 || result.status === 408 || result.status === 504) {
      throw new LanActionOutcomeUnknownError()
    }
    throw new Error(`Mac 局域网动作失败（HTTP ${result.status}）`)
  }
  const data = result.data as { ok?: boolean; result?: T; error?: string }
  if (!data?.ok) throw new Error(data?.error || '局域网动作执行失败')
  return data.result as T
}

/** Read a versioned LAN DTO. The complete target, including query parameters,
 * is included in the HMAC so pagination and resource filters cannot be
 * changed after a valid request has been signed. */
export async function callLanRead<T>(connection: LanConnection, path: string): Promise<T> {
  const result = await signedLanRequest(connection, path, 'GET')
  throwForLanAuthorization(result.status)
  if (!result.ok) throw new Error(`Mac 局域网服务不可用（HTTP ${result.status}）`)
  return result.data as T
}

/**
 * Capacitor iOS will re-encode an object passed as `data`, which can change
 * the exact JSON bytes after the HMAC has been calculated. LAN writes sign
 * the body hash, so pass the original JSON text through unchanged.
 */
export function preserveSignedNativeRequestBody(body?: string): string | undefined {
  return body || undefined
}

/**
 * Creates a short-lived URL for an image element. The pairing secret remains
 * on-device: only a time-bound HMAC is exposed in the URL because `<img>`
 * cannot attach the regular LAN authentication headers.
 */
export async function createLanImageURL(connection: LanConnection, attachmentURL: string, nowMs = Date.now()): Promise<string> {
  const name = chatImageNameFromURL(attachmentURL)
  if (!name) throw new Error('无效的局域网图片地址')
  const baseUrl = normalizeBase(connection.baseUrl)
  const deviceID = connection.deviceId.trim()
  const secret = connection.deviceSecret.trim()
  if (!baseUrl || !deviceID || !secret) throw new Error('局域网配对信息不完整')
  const imagePath = `/lan/v1/images/${encodeURIComponent(name)}`
  const expiresAt = Math.floor(nowMs / 1000) + LAN_IMAGE_URL_LIFETIME_SECONDS
  const signature = await hmacSha256(secret, `GET\n${imagePath}\n${deviceID}\n${expiresAt}`)
  const query = new URLSearchParams({ device_id: deviceID, expires: String(expiresAt), signature })
  return `${baseUrl}${imagePath}?${query.toString()}`
}

function chatImageNameFromURL(rawURL: string): string | null {
  const path = String(rawURL || '').trim().split(/[?#]/, 1)[0]
  if (!path.startsWith('/api/chat-images/')) return null
  const name = path.slice('/api/chat-images/'.length)
  if (!/^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(name)) return null
  return name
}

async function signedLanRequest(connection: LanConnection, path: string, method: string, body?: string, idempotencyKey?: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const timestamp = new Date().toISOString()
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const digest = await sha256Hex(body || '')
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${digest}${idempotencyKey ? `\n${idempotencyKey}` : ''}`
  const signature = await hmacSha256(connection.deviceSecret.trim(), canonical)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Atolla-Device': connection.deviceId.trim(), 'X-Atolla-Timestamp': timestamp, 'X-Atolla-Nonce': nonce, 'X-Atolla-Signature': signature }
  if (idempotencyKey) headers['X-Atolla-Idempotency-Key'] = idempotencyKey
  const url = `${normalizeBase(connection.baseUrl)}${path}`
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({ url, method, headers, data: preserveSignedNativeRequestBody(body), connectTimeout: 5_000, readTimeout: 30_000 })
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data }
  }
  const response = await fetch(url, { method, headers, body })
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) }
}

async function sha256Hex(value: string): Promise<string> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(raw)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const raw = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(raw)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
