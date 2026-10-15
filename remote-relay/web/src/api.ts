/** Site JWT storage key */
export const TOKEN_KEY = 'relay_site_token'

/** Per-instance unlock tokens (session, 24h server TTL) */
const UNLOCK_KEY_PREFIX = 'relay_unlock:'

export type InstanceHostMeta = {
  os?: string
  ip?: string
  uptime_sec?: number
  cpu_pct?: number
  mem_pct?: number
  disk_pct?: number
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
}

/** Clear session token */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  clearAllUnlockTokens()
}

/** Persist unlock token for one instance */
export function setUnlockToken(instanceId: string, token: string): void {
  sessionStorage.setItem(UNLOCK_KEY_PREFIX + instanceId, token)
}

/** Read unlock token for instance */
export function getUnlockToken(instanceId: string): string | null {
  return sessionStorage.getItem(UNLOCK_KEY_PREFIX + instanceId)
}

/** Drop unlock for one instance (e.g. after 注销) */
export function clearUnlockToken(instanceId: string): void {
  sessionStorage.removeItem(UNLOCK_KEY_PREFIX + instanceId)
}

/** Clear all unlock tokens */
export function clearAllUnlockTokens(): void {
  const keys: string[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    if (k?.startsWith(UNLOCK_KEY_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => sessionStorage.removeItem(k))
}

/** Whether this instance was unlocked in this browser session */
export function hasUnlockToken(instanceId: string): boolean {
  return !!getUnlockToken(instanceId)
}

type ApiError = { error?: string }

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

/** JSON fetch with bearer auth (+ unlock header for instance detail); throws on non-OK */
async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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

  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & ApiError

  if (!res.ok) {
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
  const data = await request<{ instances: PublicInstance[] }>('/api/instances')
  return data.instances
}

/** 注销：撤销实例 Mac 密码 */
export async function revokeInstancePassword(instanceId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/instances/${encodeURIComponent(instanceId)}/password`, {
    method: 'DELETE',
  })
  clearUnlockToken(instanceId)
}

/** 进入实例：校验 6 位密码，拿到 unlock_token */
export async function unlockInstance(
  instanceId: string,
  password: string,
): Promise<{ unlock_token: string; expires_in: number }> {
  const data = await request<{ unlock_token: string; expires_in: number }>(
    `/api/instances/${encodeURIComponent(instanceId)}/unlock`,
    {
      method: 'POST',
      body: JSON.stringify({ password }),
    },
  )
  setUnlockToken(instanceId, data.unlock_token)
  return data
}

/** Mirror agents for an instance */
export async function fetchAgents(instanceId: string): Promise<PublicMirrorAgent[]> {
  const data = await request<{ agents: PublicMirrorAgent[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents`,
  )
  return data.agents
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

/** Enqueue agent.ask on Mac */
export async function askAgent(
  instanceId: string,
  agentId: string,
  question: string,
): Promise<void> {
  await request<{ command: unknown }>(
    `/api/instances/${encodeURIComponent(instanceId)}/agents/${encodeURIComponent(agentId)}/ask`,
    {
      method: 'POST',
      body: JSON.stringify({ question }),
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
