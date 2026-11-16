import { Capacitor, CapacitorHttp } from '@capacitor/core'
import {
  clearAllNativeUnlockTokens,
  clearNativeSiteSession,
  clearNativeUnlockToken,
  syncNativeSiteToken,
  syncNativeUnlockToken,
} from './nativeCredentials'
import { resolveApiUrl } from './utils/apiBase'
import { invalidateRevokedLanSession } from './utils/connectionSession'
import { mergeInstanceSources, type InstanceConnection } from './utils/instanceSources'
import { LanActionIdempotencyRegistry, LanAuthorizationError, callLanAction, callLanRead, checkLanConnection, decideLanActionRecovery, getLanConnection, listLanConnections, recordLanFailure, recordLanRoute } from './utils/lanConnection'

/** Site JWT storage key */
export const TOKEN_KEY = 'relay_site_token'

/** Per-instance unlock tokens (persisted; server device session, 7d TTL) */
const UNLOCK_KEY_PREFIX = 'relay_unlock:'

/** Guess a short device label from User-Agent for unlock session */
export function guessDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Mobile'
  const ua = navigator.userAgent || ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  return 'Mobile'
}

export type InstanceHostMeta = {
  os?: string
  ip?: string
  uptime_sec?: number
  cpu_pct?: number
  mem_pct?: number
  disk_pct?: number
  /** Representative host temperature in °C */
  temp_c?: number
}

export type PublicInstance = {
  instance_id: string
  display_name: string
  last_heartbeat_at: number | null
  status: string
  registry_version: number
  actions: string[]
  password_expires_at: number | null
  has_password: boolean
  host?: InstanceHostMeta
  /** Mac 已上报 SMTP 可用 */
  unlock_otp_smtp_ok?: boolean
  /** SMTP + 站点收件邮箱均就绪 */
  unlock_otp_ready?: boolean
  /** The selected transport for this instance in the mobile client. */
  connection?: InstanceConnection
}

export type UnlockOtpStatus = {
  ready: boolean
  smtp_ok: boolean
  receive_email_set: boolean
  receive_email_masked: string
}

export type PublicMirrorAgent = {
  agent_id: string
  display_name: string | null
  engine: string | null
  status: string | null
  payload: Record<string, unknown>
  synced_at: number
}

export type PublicMirrorTask = {
  agent_id: string
  task_id: string
  status: string | null
  payload: Record<string, unknown>
  synced_at: number
}

export type PublicMirrorMessage = {
  message_id: string
  agent_id: string
  role: string | null
  content: string | null
  payload: Record<string, unknown>
  created_at: number | null
  synced_at: number
}

export type MessagesPage = {
  messages: PublicMirrorMessage[]
  limit: number
  has_more: boolean
}

/** Read stored site token */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

/** Persist site token after login */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  void syncNativeSiteToken(token)
}

/** Clear session token */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  clearAllLocalUnlockTokens()
  void clearNativeSiteSession()
}

/** Persist unlock token for one instance (localStorage survives iOS tab discard) */
export function setUnlockToken(instanceId: string, token: string): void {
  const key = UNLOCK_KEY_PREFIX + instanceId
  localStorage.setItem(key, token)
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  void syncNativeUnlockToken(instanceId, token)
}

/** Read unlock token for instance (migrates legacy sessionStorage once) */
export function getUnlockToken(instanceId: string): string | null {
  const key = UNLOCK_KEY_PREFIX + instanceId
  const fromLocal = localStorage.getItem(key)
  if (fromLocal) return fromLocal
  try {
    const legacy = sessionStorage.getItem(key)
    if (legacy) {
      localStorage.setItem(key, legacy)
      sessionStorage.removeItem(key)
      return legacy
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Drop unlock for one instance (e.g. after 注销) */
export function clearUnlockToken(instanceId: string): void {
  const key = UNLOCK_KEY_PREFIX + instanceId
  localStorage.removeItem(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  void clearNativeUnlockToken(instanceId)
}

/** Clear all unlock tokens */
export function clearAllUnlockTokens(): void {
  clearAllLocalUnlockTokens()
  void clearAllNativeUnlockTokens()
}

/** Clear Web storage without scheduling a second native operation. */
function clearAllLocalUnlockTokens(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(UNLOCK_KEY_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
  try {
    const sk: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(UNLOCK_KEY_PREFIX)) sk.push(k)
    }
    sk.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

/** Whether this instance has a stored unlock token */
export function hasUnlockToken(instanceId: string): boolean {
  return !!getUnlockToken(instanceId)
}

type ApiError = { error?: string }
const lanActionKeys = new LanActionIdempotencyRegistry()

/**
 * Forget a revoked QR credential before a route-level 401 handler redirects
 * to Login. Without this, Login sees the stale LAN session as valid and sends
 * the App straight back to the protected page, creating a white-screen loop.
 */
function handleLanAuthorizationFailure(instanceId: string, error: unknown): void {
  if (error instanceof LanAuthorizationError) {
    invalidateRevokedLanSession(instanceId)
  }
}

/** Extract instance id from /api/instances/:id/... paths */
function instanceIdFromPath(path: string): string | null {
  const m = /^\/api\/instances\/([^/]+)\//.exec(path)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/** Maps the currently supported mobile writes to the local Mac action registry.
 * Every mapped write receives an idempotency fingerprint before dispatch. */
function lanActionForRequest(path: string, method: string, body?: BodyInit | null): { action: string; payload: Record<string, unknown>; idempotencyFingerprint: string } | null {
  if (method !== 'POST' && method !== 'DELETE') return null
  const imageMatch = /^\/api\/instances\/[^/]+\/agents\/([^/]+)\/chat-images$/.exec(path)
  if (method === 'POST' && imageMatch) {
    const payload = typeof body === 'string' ? (JSON.parse(body || '{}') as Record<string, unknown>) : {}
    payload.agent_id = decodeURIComponent(imageMatch[1])
    return { action: 'chat.image.upload', payload, idempotencyFingerprint: `${path}\n${String(body || '')}` }
  }
  const taskQueueMatch = /^\/api\/instances\/[^/]+\/agents\/([^/]+)\/task-queue(?:\/(interrupt|continue|clear-done)|\/(\d+)\/(cancel|update))?$/.exec(path)
  if (method === 'POST' && taskQueueMatch) {
    const payload = typeof body === 'string' ? (JSON.parse(body || '{}') as Record<string, unknown>) : {}
    payload.agent_id = decodeURIComponent(taskQueueMatch[1])
    if (taskQueueMatch[3]) payload.task_id = Number(taskQueueMatch[3])
    const suffix = taskQueueMatch[2] || taskQueueMatch[4] || 'enqueue'
    const actionBySuffix: Record<string, string> = {
      enqueue: 'agent.task_queue.enqueue',
      interrupt: 'agent.task_queue.interrupt',
      continue: 'agent.task_queue.continue',
      cancel: 'agent.task_queue.cancel',
      update: 'agent.task_queue.update',
      'clear-done': 'agent.task_queue.clear_done',
    }
    return {
      action: actionBySuffix[suffix],
      payload,
      idempotencyFingerprint: `${path}\n${String(body || '')}`,
    }
  }
  const match = /^\/api\/instances\/[^/]+\/agents\/([^/]+)\/(ask|stop|task-plan|auto-review|auto-approve-all)$/.exec(path)
  if (!match) return null
  const payload = typeof body === 'string' ? (JSON.parse(body || '{}') as Record<string, unknown>) : {}
  payload.agent_id = decodeURIComponent(match[1])
  const actionByEndpoint: Record<string, string> = {
    ask: 'agent.ask', stop: 'agent.stop', 'task-plan': 'agent.set_task_plan',
    'auto-review': 'agent.set_auto_review', 'auto-approve-all': 'agent.set_auto_approve_all',
  }
  return { action: actionByEndpoint[match[2]], payload, idempotencyFingerprint: `${path}\n${String(body || '')}` }
}

/** Maps only LAN Facade reads that already have a local DTO implementation.
 * Unknown reads deliberately remain cloud-backed until their contract is
 * added to the Mac Facade; guessing here would create stale or partial UI. */
function lanReadForRequest(path: string, method: string): string | null {
  if (method !== 'GET') return null
  const url = new URL(path, 'http://atolla.invalid')
  const segments = url.pathname.split('/').filter(Boolean)
  if (url.pathname === '/api/instances') return '/lan/v1/reads/instances'
  if (segments[0] !== 'api' || segments[1] !== 'instances' || !segments[2]) return null
  const instanceId = decodeURIComponent(segments[2])
  const base = new URLSearchParams({ instance_id: instanceId })
  if (segments.length === 4 && segments[3] === 'agents') {
    return `/lan/v1/reads/agents?${base.toString()}`
  }
  if (segments.length === 5 && segments[3] === 'permissions' && segments[4] === 'pending') {
    return `/lan/v1/reads/permissions?${base.toString()}`
  }
  if (segments.length === 5 && segments[3] === 'engines' && segments[4] === 'usage') {
    copyLanQuery(base, url, ['fresh'])
    return lanReadActionPath('engines.usage.get', base)
  }
  if (segments.length === 4 && segments[3] === 'notify-prefs') {
    return lanReadActionPath('notify.prefs.get', base)
  }
  if (segments.length === 5 && segments[3] === 'jevos' && segments[4] === 'settings') {
    copyLanQuery(base, url, ['force'])
    return lanReadActionPath('jevos.settings.get', base)
  }
  if (segments.length < 6 || segments[3] !== 'agents') return null
  const agentId = decodeURIComponent(segments[4])
  base.set('agent_id', agentId)
  if (segments.length === 6 && segments[5] === 'tasks') {
    return `/lan/v1/reads/tasks?${base.toString()}`
  }
  if (segments.length === 6 && segments[5] === 'messages') {
    for (const key of ['before_id', 'limit']) {
      const value = url.searchParams.get(key)
      if (value) base.set(key, value)
    }
    return `/lan/v1/reads/messages?${base.toString()}`
  }
  if (segments.length === 7 && segments[5] === 'permissions' && segments[6] === 'pending') {
    return `/lan/v1/reads/permissions?${base.toString()}`
  }
  if (segments.length === 6 && segments[5] === 'task-queue') {
    return lanReadActionPath('agent.task_queue.list', base)
  }
  if (segments.length === 7 && segments[5] === 'task-plan' && segments[6] === 'active') {
    return lanReadActionPath('agent.task_plan.active', base)
  }
  if (segments.length === 6 && segments[5] === 'settings') {
    return lanReadActionPath('agent.settings.get', base)
  }
  if (segments.length === 6 && segments[5] === 'skills') {
    return lanReadActionPath('agent.skills.list', base)
  }
  if (segments.length === 7 && segments[5] === 'skills' && segments[6] === 'store') {
    copyLanQuery(base, url, ['q', 'category', 'risk'])
    return lanReadActionPath('agent.skills.store', base)
  }
  if (segments.length === 6 && segments[5] === 'legacy-mounts') {
    return lanReadActionPath('agent.legacy_mounts.list', base)
  }
  return null
}

function copyLanQuery(target: URLSearchParams, source: URL, keys: string[]): void {
  for (const key of keys) {
    const value = source.searchParams.get(key)
    if (value) target.set(key, value)
  }
}

function lanReadActionPath(action: string, query: URLSearchParams): string {
  return `/lan/v1/reads/actions/${encodeURIComponent(action)}?${query.toString()}`
}

/** JSON fetch with bearer auth (+ unlock header for instance detail); throws on non-OK */
type ApiRequestInit = RequestInit & { nativeReadTimeout?: number }

async function request<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
	const method = String(init.method || 'GET').toUpperCase()
	const lan = lanActionForRequest(path, method, init.body)
	const lanRead = lanReadForRequest(path, method)
	if (lan || lanRead) {
		const instanceId = instanceIdFromPath(path)
		const connection = getLanConnection(instanceId || undefined)
		if (connection.strategy !== 'cloud_only' && connection.baseUrl && connection.deviceId && connection.deviceSecret) {
			if (lan) {
				try {
					await checkLanConnection(connection)
				} catch (error) {
					handleLanAuthorizationFailure(instanceId || '', error)
					if (error instanceof LanAuthorizationError) throw error
					if (decideLanActionRecovery({ phase: 'preflight_failed', strategy: connection.strategy }) !== 'cloud_fallback') throw error
					lanActionKeys.clearAfterKnownOutcome(lan.idempotencyFingerprint)
					// No action request has been dispatched, so the existing cloud
					// request is safe to use as the fallback.
					recordLanFailure(instanceId || '', error)
					return requestCloud<T>(path, init)
				}
				try {
					const idempotencyKey = lanActionKeys.acquire(lan.idempotencyFingerprint)
					const result = await callLanAction<T>(connection, lan.action, lan.payload, idempotencyKey)
					lanActionKeys.clearAfterKnownOutcome(lan.idempotencyFingerprint)
					recordLanRoute(instanceId || '', { channel: 'lan', failureCount: 0, lastSuccessAt: Date.now() })
					return result
				} catch (error) {
					handleLanAuthorizationFailure(instanceId || '', error)
					// The action may have reached Mac. Never replay it on cloud without
					// a shared idempotency protocol on the remote relay.
					lanActionKeys.keepForUnknownOutcome(lan.idempotencyFingerprint)
					recordLanFailure(instanceId || '', error)
					throw error
				}
			}
			try { const value = await callLanRead<T>(connection, lanRead as string); recordLanRoute(instanceId || '', { channel: 'lan', failureCount: 0, lastSuccessAt: Date.now() }); return value }
			catch (error) {
				handleLanAuthorizationFailure(instanceId || '', error)
				recordLanFailure(instanceId || '', error)
				if (error instanceof LanAuthorizationError || connection.strategy === 'lan_only') throw error
			}
		}
	}
	const localConnection = getLanConnection(instanceIdFromPath(path) || undefined)
	if (
		path !== '/api/auth/login' &&
		!getToken() &&
		localConnection.strategy === 'lan_only' &&
		localConnection.baseUrl &&
		localConnection.deviceId &&
		localConnection.deviceSecret
	) {
		// A first-time LAN user has deliberately not configured cloud access.
		// 登录接口是例外：用户正是在首次登录页提供中继地址和密码，
		// 不能因为旧的 LAN-only 配对记录而拦截这次显式的远程登录。
		// 其它业务请求仍阻止落到空的云端地址，避免产生误导性网络错误。
		throw new Error('此功能需要配置远程中继。请在“中继与连接”添加服务器地址并完成登录。')
	}
	return requestCloud<T>(path, init)
}

/** Existing Tencent Cloud request path. Kept separate so LAN write preflight
 * can safely choose it only before any local side effect is dispatched. */
async function requestCloud<T>(path: string, init: ApiRequestInit): Promise<T> {
	const method = String(init.method || 'GET').toUpperCase()
	const { nativeReadTimeout, ...fetchInit } = init
	const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const iid = instanceIdFromPath(path)
  if (iid && !path.endsWith('/unlock') && !path.endsWith('/password')) {
    const unlock = getUnlockToken(iid)
    if (unlock) headers.set('X-Instance-Unlock', unlock)
  }

  // App 壳内无同源代理，需拼 VITE_API_BASE / 设置里的中继地址
  const url = resolveApiUrl(path)
  const headerMap: Record<string, string> = {}
  headers.forEach((value, key) => {
    headerMap[key] = value
  })

  // 原生：显式 CapacitorHttp → URLSession，避开 WKWebView ATS / 混合内容
  if (Capacitor.isNativePlatform()) {
    let dataBody: unknown
    if (init.body != null && method !== 'GET' && method !== 'HEAD') {
      const raw = typeof init.body === 'string' ? init.body : String(init.body)
      try {
        dataBody = JSON.parse(raw)
      } catch {
        dataBody = raw
      }
    }
    let native: { status: number; data: unknown }
    try {
      native = await CapacitorHttp.request({
        url,
        method,
        headers: headerMap,
        data: dataBody,
        connectTimeout: 20_000,
        readTimeout: nativeReadTimeout ?? 120_000,
      })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      throw Object.assign(
        new Error(
          /App Transport Security|secure connection|load failed|failed to fetch/i.test(raw)
            ? '无法连接中继：请 Xcode 菜单 Product → Clean Build Folder 后重新 Run 安装'
            : raw || '网络错误',
        ),
        { status: undefined as number | undefined },
      )
    }
    const data = (native.data && typeof native.data === 'object' ? native.data : {}) as T & ApiError
    if (native.status < 200 || native.status >= 300) {
      if (native.status === 401 && path !== '/api/auth/login') clearToken()
      const msg =
        typeof data.error === 'string' && data.error.trim()
          ? data.error
          : typeof native.data === 'string' && native.data.trim()
            ? native.data
            : '请求失败，请稍后重试'
      throw Object.assign(new Error(msg), { status: native.status })
    }
    return data
  }

  let res: Response
  try {
    res = await fetch(url, { ...fetchInit, headers })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const err = new Error(
      /load failed|failed to fetch|networkerror|网络|App Transport Security/i.test(raw)
        ? '无法连接中继（检查 API 地址 / 防火墙 / 是否 https）'
        : raw || '网络错误',
    ) as Error & { status?: number }
    throw err
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiError

  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') clearToken()
    const msg =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : '请求失败，请稍后重试'
    const err = new Error(msg) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data
}

/** Site gate login */
export async function login(password: string): Promise<string> {
  const data = await request<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  setToken(data.token)
  return data.token
}

/** Validate current session */
export async function fetchMe(): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/me')
}

/** List registered instances */
export async function fetchInstances(): Promise<PublicInstance[]> {
  const lanConnections = listLanConnections()
  const lanResults = await Promise.allSettled(
    lanConnections.map((connection) => callLanRead<{ instances: PublicInstance[] }>(connection, '/lan/v1/reads/instances')),
  )
  const lanInstances = lanResults.flatMap((result) =>
    result.status === 'fulfilled' && Array.isArray(result.value.instances) ? result.value.instances : [],
  )

  let serverInstances: PublicInstance[] = []
  let serverError: unknown
  if (getToken()) {
    try {
      const data = await requestCloud<{ instances: PublicInstance[] }>('/api/instances', {})
      serverInstances = Array.isArray(data.instances) ? data.instances : []
    } catch (error) {
      serverError = error
    }
  }
  if (lanInstances.length === 0 && serverError) throw serverError
  if (lanInstances.length === 0 && !getToken() && lanConnections.length > 0) {
    const failed = lanResults.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  return mergeInstanceSources(serverInstances, lanInstances) as PublicInstance[]
}

/** 注销：撤销实例 Mac 密码 */
export async function revokeInstancePassword(instanceId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/instances/${encodeURIComponent(instanceId)}/password`, {
    method: 'DELETE',
  })
  clearUnlockToken(instanceId)
}

/** 进入实例：校验 6 位密码或邮箱验证码，拿到 unlock_token（服务端设备会话） */
export async function unlockInstance(
  instanceId: string,
  password: string,
): Promise<{ unlock_token: string; expires_in: number; session_id: string }> {
  const data = await request<{
    unlock_token: string
    expires_in: number
    session_id: string
  }>(`/api/instances/${encodeURIComponent(instanceId)}/unlock`, {
    method: 'POST',
    body: JSON.stringify({ password, device_label: guessDeviceLabel() }),
  })
  setUnlockToken(instanceId, data.unlock_token)
  return data
}

/** 验证码登录能力（解锁弹窗按钮灰/亮） */
export async function fetchUnlockOtpStatus(instanceId: string): Promise<UnlockOtpStatus> {
  return request<UnlockOtpStatus>(
    `/api/instances/${encodeURIComponent(instanceId)}/unlock-otp/status`,
  )
}

/** 发送一次性解锁验证码到站点接收邮箱 */
export async function sendUnlockOtp(
  instanceId: string,
): Promise<{ ok: boolean; expires_in: number; receive_email_masked: string }> {
  return request(`/api/instances/${encodeURIComponent(instanceId)}/unlock-otp/send`, {
    method: 'POST',
    body: '{}',
  })
}

/** 读取站点接收邮箱 */
export async function fetchReceiveEmail(): Promise<{
  email: string
  email_masked: string
  set: boolean
}> {
  return request('/api/site/receive-email')
}

/** 保存站点接收邮箱（空字符串清除） */
export async function saveReceiveEmail(email: string): Promise<{
  ok: boolean
  email: string
  email_masked: string
  set: boolean
}> {
  return request('/api/site/receive-email', {
    method: 'PUT',
    body: JSON.stringify({ email }),
  })
}

/** Keep device session online while browsing an instance */
export async function heartbeatUnlockSession(instanceId: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/instances/${encodeURIComponent(instanceId)}/sessions/heartbeat`,
    { method: 'POST', body: '{}' },
  )
}

/** Revoke this device unlock on server and clear local token */
export async function logoutUnlockSession(instanceId: string): Promise<void> {
  try {
    await request<{ ok: boolean }>(
      `/api/instances/${encodeURIComponent(instanceId)}/sessions/me`,
      { method: 'DELETE' },
    )
  } finally {
    clearUnlockToken(instanceId)
  }
}

/** Mirror agents for an instance */
export async function fetchAgents(instanceId: string): Promise<PublicMirrorAgent[]> {
  const data = await request<{ agents: PublicMirrorAgent[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents`,
  )
  return data.agents
}

/** Create a custom digital employee on Mac (no talent presets) */
export async function createAgent(
  instanceId: string,
  body: { name: string; engine: string; jelly_color?: string },
): Promise<{ agent_id: string; display_name: string; engine: string }> {
  return request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

/** Mirror tasks for an agent */
export async function fetchTasks(
  instanceId: string,
  agentId: string,
): Promise<PublicMirrorTask[]> {
  const data = await request<{ tasks: PublicMirrorTask[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/tasks`,
  )
  return data.tasks
}

/** Read cached messages from mirror */
export async function fetchMessages(
  instanceId: string,
  agentId: string,
  opts?: { limit?: number; before_id?: string },
): Promise<MessagesPage> {
  const params = new URLSearchParams()
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.before_id) params.set('before_id', opts.before_id)
  const qs = params.toString()
  const path = `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/messages${qs ? `?${qs}` : ''}`
  return request<MessagesPage>(path)
}

/** Ask Mac to sync messages into relay mirror */
export async function syncMessages(
  instanceId: string,
  agentId: string,
  body?: { limit?: number; before_id?: string },
): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/sync-messages`,
    {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    },
  )
}

export type ChatImageAttachment = {
  id?: string
  url?: string
  mime?: string
  name?: string
}

export type AskMode = 'direct' | 'enqueue' | 'interrupt'

/** Enqueue agent.ask on Mac (optional attachments + mode) */
export async function askAgent(
  instanceId: string,
  agentId: string,
  question: string,
  attachments?: ChatImageAttachment[],
  mode?: AskMode,
): Promise<void> {
  const body: Record<string, unknown> = { question }
  if (attachments?.length) body.attachments = attachments
  if (mode) body.mode = mode
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/ask`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

export type TaskPlanStepDTO = {
  id?: string
  title: string
  detail?: string
  status?: string
}

export type ActiveTaskPlanDTO = {
  plan_id: string
  phase: string
  frozen?: boolean
  task_name?: string
  progress?: number
  message?: string
  current_step?: number
  total_count?: number
  step_items?: TaskPlanStepDTO[]
  queue_item_id?: number
}

export type TaskQueueItem = {
  id: number
  agent_id?: number
  status: string
  question: string
  position?: number
  silent_notify?: boolean
  resume_hint?: boolean
  kind?: string
  plan_id?: string
  locked?: boolean
  plan?: ActiveTaskPlanDTO | null
}

export type TaskQueueView = {
  items: TaskQueueItem[]
  hold: boolean
  active: number
}

/** 拉取任务队列轨 */
export async function fetchTaskQueue(instanceId: string, agentId: string): Promise<TaskQueueView> {
  const data = await request<TaskQueueView>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue`,
  )
  return {
    items: Array.isArray(data.items) ? data.items : [],
    hold: !!data.hold,
    active: Number(data.active) || 0,
  }
}

/** 入队 */
export async function enqueueTaskQueue(
  instanceId: string,
  agentId: string,
  question: string,
  attachments?: ChatImageAttachment[],
): Promise<void> {
  const body: Record<string, unknown> = { question }
  if (attachments?.length) body.attachments = attachments
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

/** 打断优先 */
export async function interruptTaskQueue(
  instanceId: string,
  agentId: string,
  question: string,
  attachments?: ChatImageAttachment[],
): Promise<void> {
  const body: Record<string, unknown> = { question }
  if (attachments?.length) body.attachments = attachments
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue/interrupt`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

/** 继续队列 */
export async function continueTaskQueue(instanceId: string, agentId: string): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue/continue`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** 取消 queued/paused */
export async function cancelTaskQueueItem(
  instanceId: string,
  agentId: string,
  taskId: number,
): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue/${taskId}/cancel`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** 改写未执行项文案（queued/paused） */
export async function updateTaskQueueItem(
  instanceId: string,
  agentId: string,
  taskId: number,
  question: string,
): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue/${taskId}/update`,
    { method: 'POST', body: JSON.stringify({ question }) },
  )
}

/** 清除终态展示 */
export async function clearTaskQueueDone(instanceId: string, agentId: string): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-queue/clear-done`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** Upload compressed chat image (base64) via Mac */
export async function uploadChatImage(
  instanceId: string,
  agentId: string,
  dataBase64: string,
  filename?: string,
): Promise<{ id: string; url: string; mime: string; name: string }> {
  return request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/chat-images`,
    {
      method: 'POST',
      body: JSON.stringify({
        data_base64: dataBase64,
        filename: filename || 'mobile.jpg',
      }),
    },
  )
}

/** Enqueue agent.stop */
export async function stopAgent(instanceId: string, agentId: string): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/stop`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** Enqueue agent.set_task_plan */
export async function setAgentTaskPlan(
  instanceId: string,
  agentId: string,
  enabled: boolean,
): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-plan`,
    {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    },
  )
}

/** 拉取活跃任务计划（中继 RPC，body.plan） */
export async function fetchActiveTaskPlan(
  instanceId: string,
  agentId: string,
): Promise<ActiveTaskPlanDTO | null> {
  const res = await request<{ plan?: ActiveTaskPlanDTO | null }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-plan/active`,
  )
  return res.plan ?? null
}

export async function confirmTaskPlan(
  instanceId: string,
  agentId: string,
  planId: string,
  steps?: TaskPlanStepDTO[],
): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-plan/${encodeURIComponent(planId)}/confirm`,
    { method: 'POST', body: JSON.stringify({ steps: steps ?? [] }) },
  )
}

export async function rejectTaskPlan(
  instanceId: string,
  agentId: string,
  planId: string,
): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-plan/${encodeURIComponent(planId)}/reject`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export async function abortTaskPlan(
  instanceId: string,
  agentId: string,
  planId: string,
): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-plan/${encodeURIComponent(planId)}/abort`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export async function resumeTaskPlan(
  instanceId: string,
  agentId: string,
  planId: string,
): Promise<void> {
  await request(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/task-plan/${encodeURIComponent(planId)}/resume`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** Enqueue agent.set_auto_review */
export async function setAgentAutoReview(
  instanceId: string,
  agentId: string,
  enabled: boolean,
): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/auto-review`,
    {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    },
  )
}

/** Enqueue agent.set_auto_approve_all */
export async function setAgentAutoApproveAll(
  instanceId: string,
  agentId: string,
  enabled: boolean,
): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/auto-approve-all`,
    {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    },
  )
}

/** Tell Mac this phone is viewing the agent (heartbeat) */
export async function setViewerPresence(instanceId: string, agentId: string): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/viewer`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

/** Tell Mac this phone left the agent chat */
export async function clearViewerPresence(instanceId: string, agentId: string): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/viewer`,
    { method: 'DELETE' },
  )
}

/** 主动进入对话时清未读（勿与 viewer 心跳混用） */
export async function markAgentTaskRead(instanceId: string, agentId: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/mark-read`,
    { method: 'POST', body: '{}' },
  )
}

export type PublicMirrorPermission = {
  request_id: string
  agent_id: string
  conversation_id: number
  tool_name: string | null
  summary: string | null
  note: string | null
  meaning: string | null
  risk: string | null
  created_at: string | null
  deadline: string | null
  synced_at: number
}

/** Pending permission cards for one agent */
export async function fetchPendingPermissions(
  instanceId: string,
  agentId: string,
): Promise<PublicMirrorPermission[]> {
  const data = await request<{ items: PublicMirrorPermission[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/permissions/pending`,
  )
  return data.items ?? []
}

/** Pending permission cards across one unlocked instance */
export async function fetchPendingInstancePermissions(
  instanceId: string,
): Promise<PublicMirrorPermission[]> {
  const data = await request<{ items: PublicMirrorPermission[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/permissions/pending`,
  )
  return data.items ?? []
}

/** Enqueue permission.decide */
export async function decidePermission(
  instanceId: string,
  agentId: string,
  requestId: string,
  behavior: 'allow' | 'deny' | 'allow_session',
): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/permissions/decide`,
    {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, behavior }),
    },
  )
}

/** Agent settings payload from Mac via relay RPC */
export type AgentSettings = {
  agent_id: string
  name: string
  engine: string
  rules_prompt: string
  /** Pixel jelly color from Mac */
  jelly_color?: string
  skill_count: number
}

/** Skill row (installed merge or store catalog) */
export type AgentSkill = {
  id: string
  name: string
  summary?: string
  description?: string
  icon_key?: string
  icon_url?: string
  category?: string
  risk?: string
  installed?: boolean
  enabled?: boolean
  capabilities?: string[]
}

/** Read-only legacy memory mount */
export type LegacyMount = {
  id: number
  agent_id: number
  legacy_memory_id: number
  source_agent_name: string
  source_job_title: string
  source_avatar_url: string
  mounted_at?: string
}

/** 完成通知与命令审批通知，与电脑端设置同一份 */
export type NotifyPrefs = {
  task_done: boolean
  permission: boolean
  bark_verified?: boolean
}

/** 读取本机 Claude / Codex / Cursor 订阅额度（默认 5 分钟缓存；fresh 强制刷新） */
export async function fetchEnginesUsage(
  instanceId: string,
  opts?: { fresh?: boolean },
): Promise<{
  cached_at?: string
  ttl_seconds?: number
  engines: Array<{
    id: string
    ok: boolean
    error?: string
    source?: string
    plan?: string
    windows: Array<{
      kind: string
      label: string
      hint: string
      used_percent: number
      window_minutes?: number
      resets_at?: string
      reset_hint?: string
    }>
  }>
}> {
  const qs = opts?.fresh ? '?fresh=1' : ''
  return request(
    `/api/instances/${encodeURIComponent(instanceId)}/engines/usage${qs}`,
  )
}

/** 读取某台电脑的通知开关 */
export async function fetchNotifyPrefs(instanceId: string): Promise<NotifyPrefs> {
  return request<NotifyPrefs>(
    `/api/instances/${encodeURIComponent(instanceId)}/notify-prefs`,
  )
}

/** 保存某台电脑的通知开关 */
export async function updateNotifyPrefs(
  instanceId: string,
  prefs: NotifyPrefs,
): Promise<NotifyPrefs> {
  return request<NotifyPrefs>(
    `/api/instances/${encodeURIComponent(instanceId)}/notify-prefs`,
    {
      method: 'PUT',
      body: JSON.stringify({
        task_done: prefs.task_done,
        permission: prefs.permission,
      }),
    },
  )
}

/** 经 Bark 发送开启通知用的 6 位验证码 */
export async function sendNotifyBarkVerify(
  instanceId: string,
): Promise<{ ok: boolean; expires_in: number }> {
  return request(`/api/instances/${encodeURIComponent(instanceId)}/notify-prefs/verify/send`, {
    method: 'POST',
    body: '{}',
  })
}

/** 校验 Bark 验证码 */
export async function confirmNotifyBarkVerify(
  instanceId: string,
  code: string,
): Promise<NotifyPrefs> {
  return request<NotifyPrefs>(
    `/api/instances/${encodeURIComponent(instanceId)}/notify-prefs/verify/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ code }),
    },
  )
}

/** JEV 安装包项 */
export type JevosPackage = {
  id: string
  name: string
  os?: string
  arch?: string
  runtime_url?: string
  model_url?: string
  recommended?: boolean
  size_hint?: string
}

/** 该电脑 JEV 状态（与 PC 设置同源） */
export type JevosSettings = {
  installed: boolean
  enabled: boolean
  healthy: boolean
  detail?: string
  packages?: JevosPackage[]
  release_url?: string
  release_tag?: string
  cached?: boolean
  checked_at?: string
  can_uninstall?: boolean
}

/** 读取该电脑 JEV 状态 */
export async function fetchJevosSettings(
  instanceId: string,
  opts?: { force?: boolean },
): Promise<JevosSettings> {
  const qs = opts?.force ? '?force=1' : ''
  return request<JevosSettings>(
    `/api/instances/${encodeURIComponent(instanceId)}/jevos/settings${qs}`,
  )
}

/** 从 GitHub Release 安装 JEV（耗时长） */
export async function installJevos(
  instanceId: string,
  packageId: string,
  chinaMirror = false,
): Promise<JevosSettings> {
  return request<JevosSettings>(
    `/api/instances/${encodeURIComponent(instanceId)}/jevos/settings/install`,
    {
      method: 'POST',
      body: JSON.stringify({ package_id: packageId, china_mirror: chinaMirror }),
      // JEV 模型约 600MB，不沿用普通 API 的 120s 读取超时。
      nativeReadTimeout: 31 * 60_000,
    },
  )
}

/** JEV 胶囊开关 */
export async function setJevosEnabled(
  instanceId: string,
  enabled: boolean,
): Promise<JevosSettings> {
  return request<JevosSettings>(
    `/api/instances/${encodeURIComponent(instanceId)}/jevos/settings`,
    {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    },
  )
}

/** 卸载平台安装的 JEV */
export async function uninstallJevos(instanceId: string): Promise<JevosSettings> {
  return request<JevosSettings>(
    `/api/instances/${encodeURIComponent(instanceId)}/jevos/settings/uninstall`,
    { method: 'POST', body: '{}' },
  )
}

/** Load agent settings (rules_prompt etc.) */
export async function fetchAgentSettings(
  instanceId: string,
  agentId: string,
): Promise<AgentSettings> {
  return request<AgentSettings>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/settings`,
  )
}

/** Save rules_prompt (+ optional jelly_color) */
export async function updateAgentSettings(
  instanceId: string,
  agentId: string,
  rulesPrompt: string,
  jellyColor?: string,
): Promise<AgentSettings> {
  const body: Record<string, string> = { rules_prompt: rulesPrompt }
  if (jellyColor) body.jelly_color = jellyColor
  return request<AgentSettings>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/settings`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  )
}

/** List agent skills (catalog + install state) */
export async function fetchAgentSkills(
  instanceId: string,
  agentId: string,
): Promise<AgentSkill[]> {
  const data = await request<{ skills: AgentSkill[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/skills`,
  )
  return data.skills ?? []
}

/** Skill store catalog */
export async function fetchSkillStore(
  instanceId: string,
  agentId: string,
  opts?: { q?: string; category?: string },
): Promise<AgentSkill[]> {
  const params = new URLSearchParams()
  if (opts?.q) params.set('q', opts.q)
  if (opts?.category) params.set('category', opts.category)
  const qs = params.toString()
  const data = await request<{ skills: AgentSkill[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/skills/store${qs ? `?${qs}` : ''}`,
  )
  return data.skills ?? []
}

/** Install a catalog skill */
export async function installAgentSkill(
  instanceId: string,
  agentId: string,
  skillId: string,
  capabilities?: string[],
): Promise<AgentSkill[]> {
  const data = await request<{ skills: AgentSkill[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/skills/install`,
    {
      method: 'POST',
      body: JSON.stringify({ skill_id: skillId, capabilities }),
    },
  )
  return data.skills ?? []
}

/** Uninstall a skill */
export async function uninstallAgentSkill(
  instanceId: string,
  agentId: string,
  skillId: string,
): Promise<AgentSkill[]> {
  const data = await request<{ skills: AgentSkill[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}`,
    { method: 'DELETE' },
  )
  return data.skills ?? []
}

/** Read-only legacy memory mounts */
export async function fetchLegacyMounts(
  instanceId: string,
  agentId: string,
): Promise<LegacyMount[]> {
  const data = await request<{ items: LegacyMount[]; max?: number }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/legacy-mounts`,
  )
  return data.items ?? []
}

export type ChangelogEntry = {
  version: string
  date: string
  items: string[]
}

export type ChangelogPage = {
  items: ChangelogEntry[]
  next_cursor: string | null
  has_more: boolean
}

/** Current relay package version */
export async function fetchVersion(): Promise<string> {
  const data = await request<{ version: string }>('/api/meta/version')
  return data.version
}

/** Cursor page of CHANGELOG entries */
export async function fetchChangelogPage(opts?: {
  cursor?: string | null
  limit?: number
}): Promise<ChangelogPage> {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const qs = params.toString()
  return request<ChangelogPage>(`/api/meta/changelog${qs ? `?${qs}` : ''}`)
}
