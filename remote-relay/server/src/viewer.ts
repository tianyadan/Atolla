import type { RelayDatabase } from './db.js'

/** Phone viewing presence TTL (ms); Mac also applies its own TTL */
export const MOBILE_VIEWER_TTL_MS = 60_000

/** Persist that the phone is viewing this agent (heartbeat refreshes) */
export function setMobileViewer(
  db: RelayDatabase,
  instanceId: string,
  agentId: string,
  now = Date.now(),
): boolean {
  const id = String(agentId || '').trim()
  if (!id) return false
  const info = db
    .prepare(
      `UPDATE instances
       SET mobile_viewing_agent_id = ?, mobile_viewing_at = ?, updated_at = ?
       WHERE instance_id = ?`,
    )
    .run(id, now, now, instanceId)
  return info.changes > 0
}

/** Clear phone viewing presence */
export function clearMobileViewer(
  db: RelayDatabase,
  instanceId: string,
  now = Date.now(),
): boolean {
  const info = db
    .prepare(
      `UPDATE instances
       SET mobile_viewing_agent_id = NULL, mobile_viewing_at = NULL, updated_at = ?
       WHERE instance_id = ?`,
    )
    .run(now, instanceId)
  return info.changes > 0
}

/** Read active viewing agent id, or null if expired / unset */
export function getMobileViewerAgentId(
  db: RelayDatabase,
  instanceId: string,
  now = Date.now(),
): string | null {
  const row = db
    .prepare(
      `SELECT mobile_viewing_agent_id AS agent_id, mobile_viewing_at AS viewed_at
       FROM instances WHERE instance_id = ?`,
    )
    .get(instanceId) as { agent_id: string | null; viewed_at: number | null } | undefined
  if (!row?.agent_id || row.viewed_at == null) return null
  if (now - Number(row.viewed_at) > MOBILE_VIEWER_TTL_MS) return null
  return String(row.agent_id)
}
