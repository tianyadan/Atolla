/**
 * 解析开发运行器的 loopback 控制面。
 * WHY: Electron 39 的 process.send 不稳定；Go 的所有权不能依赖 Electron IPC。
 */
export function resolveDevRunnerControl(environment) {
  if (environment.ATOLLA_DEV_RUNNER !== '1') return null
  const url = String(environment.ATOLLA_DEV_CONTROL_URL || '').trim().replace(/\/$/, '')
  const token = String(environment.ATOLLA_DEV_CONTROL_TOKEN || '').trim()
  const userDataPath = String(environment.ATOLLA_DEV_USER_DATA_PATH || '').trim()
  if (!url || !token || !userDataPath) {
    throw new Error('dev-runner control endpoint unavailable; start with scripts/dev-electron.sh')
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('dev-runner control endpoint is invalid')
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('dev-runner control endpoint must use loopback HTTP')
  }
  return { url, token, userDataPath }
}

/** Electron 只能请求运行器管理的后端，不能自行启动或停止 Go。 */
export async function requestDevRunnerBackend(control, action, body = {}, fetchImpl = fetch) {
  if (!control) throw new Error('dev-runner control endpoint unavailable')
  if (!['ensure', 'restart'].includes(action)) throw new Error(`unsupported dev backend action: ${action}`)
  const response = await fetchImpl(`${control.url}/v1/backend/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${control.token}`,
      'content-type': 'application/json',
    },
    body: action === 'ensure' ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `dev-runner backend request failed (HTTP ${response.status})`)
  const baseUrl = String(data.baseUrl || '')
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
    throw new Error('dev-runner returned an invalid backend URL')
  }
  return baseUrl
}
