import type { RelayDatabase } from './db.js'
import { getInstanceRow } from './auth/instance.js'

/** Default page size for message mirror reads */
export const DEFAULT_MESSAGES_LIMIT = 20

/** Max messages per read request (spec: ~200 cached per agent) */
export const MAX_MESSAGES_LIMIT = 200

export type MirrorAgentInput = {
  agent_id: string
  display_name?: string | null
  engine?: string | null
  status?: string | null
  payload?: Record<string, unknown>
}

export type MirrorTaskInput = {
  agent_id: string
  task_id: string
  status?: string | null
  payload?: Record<string, unknown>
}

export type MirrorMessageInput = {
  message_id: string
  agent_id: string
  role?: string | null
  content?: string | null
  created_at?: number | null
  payload?: Record<string, unknown>
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

export type MessagesPageResult = {
  messages: PublicMirrorMessage[]
  limit: number
  has_more: boolean
}

export type MirrorPermissionInput = {
  request_id: string
  agent_id: string
  conversation_id?: number
  tool_name?: string | null
  summary?: string | null
  note?: string | null
  meaning?: string | null
  risk?: string | null
  created_at?: string | null
  deadline?: string | null
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

/** Upsert agent rows from a device snapshot batch, then prune agents missing from this full sync. */
export function upsertAgentsMirror(
  db: RelayDatabase,
  instanceId: string,
  agents: MirrorAgentInput[],
  syncedAt: number,
): number {
  const stmt = db.prepare(
    `INSERT INTO agents_mirror (
       instance_id, agent_id, display_name, engine, status, payload_json, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id, agent_id) DO UPDATE SET
       display_name = excluded.display_name,
       engine = excluded.engine,
       status = excluded.status,
       payload_json = excluded.payload_json,
       synced_at = excluded.synced_at`,
  )
  let count = 0
  const keepIds: string[] = []
  for (const a of agents) {
    const id = String(a.agent_id || '').trim()
    if (!id) continue
    keepIds.push(id)
    stmt.run(
      instanceId,
      id,
      a.display_name ?? null,
      a.engine ?? null,
      a.status ?? null,
      JSON.stringify(a.payload ?? {}),
      syncedAt,
    )
    count += 1
  }
  // Full-replace semantics: PC-deleted agents must disappear on mobile.
  if (keepIds.length === 0) {
    db.prepare(`DELETE FROM agents_mirror WHERE instance_id = ?`).run(instanceId)
  } else {
    const placeholders = keepIds.map(() => '?').join(',')
    db.prepare(
      `DELETE FROM agents_mirror WHERE instance_id = ? AND agent_id NOT IN (${placeholders})`,
    ).run(instanceId, ...keepIds)
  }
  return count
}

/** Upsert task rows from a device snapshot batch */
export function upsertTasksMirror(
  db: RelayDatabase,
  instanceId: string,
  tasks: MirrorTaskInput[],
  syncedAt: number,
): number {
  const stmt = db.prepare(
    `INSERT INTO tasks_mirror (
       instance_id, agent_id, task_id, status, payload_json, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id, agent_id, task_id) DO UPDATE SET
       status = excluded.status,
       payload_json = excluded.payload_json,
       synced_at = excluded.synced_at`,
  )
  let count = 0
  for (const t of tasks) {
    stmt.run(
      instanceId,
      t.agent_id,
      t.task_id,
      t.status ?? null,
      JSON.stringify(t.payload ?? {}),
      syncedAt,
    )
    count += 1
  }
  return count
}

/** Upsert pending permission rows from Mac Hub */
export function upsertPermissionsMirror(
  db: RelayDatabase,
  instanceId: string,
  items: MirrorPermissionInput[],
  syncedAt: number,
): number {
  const stmt = db.prepare(
    `INSERT INTO permissions_mirror (
       instance_id, request_id, agent_id, conversation_id,
       tool_name, summary, note, meaning, risk, created_at, deadline, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id, request_id) DO UPDATE SET
       agent_id = excluded.agent_id,
       conversation_id = excluded.conversation_id,
       tool_name = excluded.tool_name,
       summary = excluded.summary,
       note = excluded.note,
       meaning = excluded.meaning,
       risk = excluded.risk,
       created_at = excluded.created_at,
       deadline = excluded.deadline,
       synced_at = excluded.synced_at`,
  )
  let count = 0
  for (const p of items) {
    const agentId = String(p.agent_id || '').trim()
    const requestId = String(p.request_id || '').trim()
    if (!agentId || !requestId) continue
    stmt.run(
      instanceId,
      requestId,
      agentId,
      Number(p.conversation_id) || 0,
      p.tool_name ?? null,
      p.summary ?? null,
      p.note ?? null,
      p.meaning ?? null,
      p.risk ?? null,
      p.created_at ?? null,
      p.deadline ?? null,
      syncedAt,
    )
    count += 1
  }
  return count
}

/** Delete resolved permission rows by request_id */
export function deletePermissionsMirror(
  db: RelayDatabase,
  instanceId: string,
  requestIds: string[],
): number {
  const stmt = db.prepare(
    `DELETE FROM permissions_mirror WHERE instance_id = ? AND request_id = ?`,
  )
  let count = 0
  for (const id of requestIds) {
    const rid = String(id || '').trim()
    if (!rid) continue
    const info = stmt.run(instanceId, rid)
    count += Number(info.changes) || 0
  }
  return count
}

/** List pending permissions for one agent (skip expired by deadline when parseable) */
export function listPermissionsMirror(
  db: RelayDatabase,
  instanceId: string,
  agentId: string,
  nowMs: number = Date.now(),
): { ok: true; items: PublicMirrorPermission[] } | { ok: false; status: number; error: string } {
  if (!getInstanceRow(db, instanceId)) {
    return { ok: false, status: 404, error: 'Instance not found' }
  }
  const rows = db
    .prepare(
      `SELECT request_id, agent_id, conversation_id, tool_name, summary, note, meaning, risk,
              created_at, deadline, synced_at
       FROM permissions_mirror
       WHERE instance_id = ? AND agent_id = ?
       ORDER BY synced_at DESC, request_id ASC`,
    )
    .all(instanceId, agentId) as Array<{
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
  }>

  const items = rows.filter((r) => {
    if (!r.deadline) return true
    const t = Date.parse(r.deadline)
    if (!Number.isFinite(t)) return true
    return t > nowMs
  })

  return {
    ok: true,
    items: items.map((r) => ({
      request_id: r.request_id,
      agent_id: r.agent_id,
      conversation_id: r.conversation_id,
      tool_name: r.tool_name,
      summary: r.summary,
      note: r.note,
      meaning: r.meaning,
      risk: r.risk,
      created_at: r.created_at,
      deadline: r.deadline,
      synced_at: r.synced_at,
    })),
  }
}

/** Upsert messages by (instance_id, message_id) */
export function upsertMessagesMirror(
  db: RelayDatabase,
  instanceId: string,
  messages: MirrorMessageInput[],
  syncedAt: number,
): number {
  const stmt = db.prepare(
    `INSERT INTO messages_mirror (
       instance_id, message_id, agent_id, role, content, payload_json, created_at, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id, message_id) DO UPDATE SET
       agent_id = excluded.agent_id,
       role = excluded.role,
       content = excluded.content,
       payload_json = excluded.payload_json,
       created_at = excluded.created_at,
       synced_at = excluded.synced_at`,
  )
  let count = 0
  for (const m of messages) {
    stmt.run(
      instanceId,
      m.message_id,
      m.agent_id,
      m.role ?? null,
      m.content ?? null,
      JSON.stringify(m.payload ?? {}),
      m.created_at ?? null,
      syncedAt,
    )
    count += 1
  }
  return count
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** List mirrored agents for an instance (404 if instance missing) */
export function listAgentsMirror(
  db: RelayDatabase,
  instanceId: string,
): { ok: true; agents: PublicMirrorAgent[] } | { ok: false; status: number; error: string } {
  if (!getInstanceRow(db, instanceId)) {
    return { ok: false, status: 404, error: 'Instance not found' }
  }
  const rows = db
    .prepare(
      `SELECT agent_id, display_name, engine, status, payload_json, synced_at
       FROM agents_mirror
       WHERE instance_id = ?
       ORDER BY display_name COLLATE NOCASE ASC, agent_id ASC`,
    )
    .all(instanceId) as Array<{
    agent_id: string
    display_name: string | null
    engine: string | null
    status: string | null
    payload_json: string
    synced_at: number
  }>

  return {
    ok: true,
    agents: rows.map((r) => ({
      agent_id: r.agent_id,
      display_name: r.display_name,
      engine: r.engine,
      status: r.status,
      payload: parsePayload(r.payload_json),
      synced_at: r.synced_at,
    })),
  }
}

/** List mirrored tasks for one agent */
export function listTasksMirror(
  db: RelayDatabase,
  instanceId: string,
  agentId: string,
): { ok: true; tasks: PublicMirrorTask[] } | { ok: false; status: number; error: string } {
  if (!getInstanceRow(db, instanceId)) {
    return { ok: false, status: 404, error: 'Instance not found' }
  }
  const rows = db
    .prepare(
      `SELECT agent_id, task_id, status, payload_json, synced_at
       FROM tasks_mirror
       WHERE instance_id = ? AND agent_id = ?
       ORDER BY synced_at DESC, task_id ASC`,
    )
    .all(instanceId, agentId) as Array<{
    agent_id: string
    task_id: string
    status: string | null
    payload_json: string
    synced_at: number
  }>

  return {
    ok: true,
    tasks: rows.map((r) => ({
      agent_id: r.agent_id,
      task_id: r.task_id,
      status: r.status,
      payload: parsePayload(r.payload_json),
      synced_at: r.synced_at,
    })),
  }
}

/** Clamp message page limit to safe bounds */
export function normalizeMessagesLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_MESSAGES_LIMIT
  const n = Math.floor(raw)
  if (n < 1) return 1
  return Math.min(n, MAX_MESSAGES_LIMIT)
}

type MessageRow = {
  message_id: string
  agent_id: string
  role: string | null
  content: string | null
  payload_json: string
  created_at: number | null
  synced_at: number
}

function rowToPublicMessage(r: MessageRow): PublicMirrorMessage {
  return {
    message_id: r.message_id,
    agent_id: r.agent_id,
    role: r.role,
    content: r.content,
    payload: parsePayload(r.payload_json),
    created_at: r.created_at,
    synced_at: r.synced_at,
  }
}

/** Paginated message mirror (newest page first; items returned ascending for chat UI) */
export function listMessagesMirror(
  db: RelayDatabase,
  instanceId: string,
  agentId: string,
  beforeId: string | undefined,
  limit: number,
): { ok: true; page: MessagesPageResult } | { ok: false; status: number; error: string } {
  if (!getInstanceRow(db, instanceId)) {
    return { ok: false, status: 404, error: 'Instance not found' }
  }

  const safeLimit = normalizeMessagesLimit(limit)
  let rows: MessageRow[]

  if (beforeId?.trim()) {
    const anchor = db
      .prepare(
        `SELECT created_at, message_id FROM messages_mirror
         WHERE instance_id = ? AND agent_id = ? AND message_id = ?`,
      )
      .get(instanceId, agentId, beforeId.trim()) as
      | { created_at: number | null; message_id: string }
      | undefined

    if (!anchor) {
      return {
        ok: true,
        page: { messages: [], limit: safeLimit, has_more: false },
      }
    }

    const createdAt = anchor.created_at ?? 0
    rows = db
      .prepare(
        `SELECT message_id, agent_id, role, content, payload_json, created_at, synced_at
         FROM messages_mirror
         WHERE instance_id = ? AND agent_id = ?
           AND (
             COALESCE(created_at, 0) < ?
             OR (COALESCE(created_at, 0) = ? AND message_id < ?)
           )
         ORDER BY COALESCE(created_at, 0) DESC, message_id DESC
         LIMIT ?`,
      )
      .all(instanceId, agentId, createdAt, createdAt, anchor.message_id, safeLimit + 1) as MessageRow[]
  } else {
    rows = db
      .prepare(
        `SELECT message_id, agent_id, role, content, payload_json, created_at, synced_at
         FROM messages_mirror
         WHERE instance_id = ? AND agent_id = ?
         ORDER BY COALESCE(created_at, 0) DESC, message_id DESC
         LIMIT ?`,
      )
      .all(instanceId, agentId, safeLimit + 1) as MessageRow[]
  }

  const hasMore = rows.length > safeLimit
  if (hasMore) rows = rows.slice(0, safeLimit)
  rows.reverse()

  return {
    ok: true,
    page: {
      messages: rows.map(rowToPublicMessage),
      limit: safeLimit,
      has_more: hasMore,
    },
  }
}
