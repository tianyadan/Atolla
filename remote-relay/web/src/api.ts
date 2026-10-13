/** Site JWT storage key */
export const TOKEN_KEY = 'relay_site_token'

export type PublicInstance = {
  instance_id: string
  display_name: string
  last_heartbeat_at: number | null
  status: string
  registry_version: number
  actions: string[]
  password_expires_at: number | null
  has_password: boolean
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
}

type ApiError = { error?: string }

/** JSON fetch with bearer auth; throws on non-OK with unified message */
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

  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & ApiError

  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : '请求失败，请稍后重试'
    throw new Error(msg)
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

/** Revoke instance Mac password on relay */
export async function revokeInstancePassword(instanceId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/instances/${encodeURIComponent(instanceId)}/password`, {
    method: 'DELETE',
  })
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
