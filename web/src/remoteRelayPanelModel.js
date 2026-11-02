export const DEPLOY_LOG_RETENTION_MS = 10 * 60 * 1000

/** 只有真正触发过部署/升级后才展示进度区，避免默认空日志占据页面。 */
export function shouldShowDeployProgress({ status, logs, running }) {
  return Boolean(running || status || (Array.isArray(logs) && logs.length > 0))
}

/** 运行中不设置过期时间；终态日志只在前端内存保留十分钟。 */
export function deployLogExpiresAt(status, completedAt = Date.now()) {
  if (status !== 'ok' && status !== 'error') return null
  return Number(completedAt) + DEPLOY_LOG_RETENTION_MS
}
