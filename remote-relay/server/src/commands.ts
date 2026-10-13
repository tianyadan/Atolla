import { randomUUID } from 'node:crypto'
import type { RelayDatabase } from './db.js'
import { getInstanceRow } from './auth/instance.js'
import { V1_EXECUTABLE } from './registry.js'

/** Lease duration for leased commands (ms) */
export const COMMAND_LEASE_MS = 60_000

/** Default long-poll wait when query param omitted (ms) */
export const DEFAULT_LONG_POLL_WAIT_MS = 25_000

/** Max commands returned per long-poll response */
export const MAX_COMMANDS_PER_POLL = 10

export type CommandStatus =
  | 'pending'
  | 'leased'
  | 'done'
  | 'error'
  | 'rejected'
  | 'expired'

export type CommandResultStatus = 'done' | 'error' | 'rejected'

export type PublicCommand = {
  id: string
  action: string
  payload: Record<string, unknown>
  status: CommandStatus
  created_at: number
}

/** Injectable clock for tests */
export type CommandClock = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const defaultCommandClock: CommandClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

const waitersByInstance = new Map<string, Set<() => void>>()

/** Wake long-poll waiters after a new command is enqueued */
function notifyLongPollWaiters(instanceId: string): void {
  const waiters = waitersByInstance.get(instanceId)
  if (!waiters?.size) return
  for (const wake of waiters) wake()
  waiters.clear()
}

/** Register a waiter until timeout or notify */
function waitForCommandSignal(
  instanceId: string,
  ms: number,
  clock: CommandClock,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const timer = setTimeout(finish, ms)
    let set = waitersByInstance.get(instanceId)
    if (!set) {
      set = new Set()
      waitersByInstance.set(instanceId, set)
    }
    const wake = () => {
      clearTimeout(timer)
      set!.delete(wake)
      finish()
    }
    set.add(wake)
  })
}

/** Whether site may enqueue this action for the given instance actions list */
export function isEnqueueActionAllowed(
  action: string,
  instanceActions: string[],
): boolean {
  if (!V1_EXECUTABLE.has(action)) return false
  return instanceActions.includes(action)
}

/** Mark timed-out leased commands as expired */
export function expireLeasedCommands(db: RelayDatabase, now: number): void {
  db.prepare(
    `UPDATE commands
     SET status = 'expired', updated_at = ?
     WHERE status = 'leased' AND leased_until IS NOT NULL AND leased_until < ?`,
  ).run(now, now)
}

/** Claim up to MAX pending commands for an instance and mark leased */
export function claimPendingCommands(
  db: RelayDatabase,
  instanceId: string,
  now: number,
): PublicCommand[] {
  expireLeasedCommands(db, now)

  const pending = db
    .prepare(
      `SELECT id, action_type, payload_json, status, created_at
       FROM commands
       WHERE instance_id = ? AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(instanceId, MAX_COMMANDS_PER_POLL) as Array<{
    id: string
    action_type: string
    payload_json: string
    status: string
    created_at: number
  }>

  if (pending.length === 0) return []

  const leasedUntil = now + COMMAND_LEASE_MS
  const update = db.prepare(
    `UPDATE commands
     SET status = 'leased', leased_until = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
  )

  const claimed: PublicCommand[] = []
  for (const row of pending) {
    const info = update.run(leasedUntil, now, row.id)
    if (info.changes === 0) continue
    claimed.push({
      id: row.id,
      action: row.action_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      status: 'leased',
      created_at: row.created_at,
    })
  }
  return claimed
}

/** Long-poll until commands are available or wait elapses */
export async function longPollCommands(
  db: RelayDatabase,
  instanceId: string,
  waitMs: number,
  clock: CommandClock = defaultCommandClock,
): Promise<PublicCommand[]> {
  const safeWait = Math.max(0, Math.min(waitMs, 120_000))
  const deadline = clock.now() + safeWait

  let commands = claimPendingCommands(db, instanceId, clock.now())
  if (commands.length > 0) return commands

  while (clock.now() < deadline) {
    const remaining = deadline - clock.now()
    if (remaining <= 0) break
    await waitForCommandSignal(instanceId, remaining, clock)
    commands = claimPendingCommands(db, instanceId, clock.now())
    if (commands.length > 0) return commands
  }

  return []
}

export type EnqueueResult =
  | { ok: true; command: PublicCommand }
  | { ok: false; status: number; error: string }

/** Enqueue a command from the site (validates registry + instance actions) */
export function enqueueCommand(
  db: RelayDatabase,
  instanceId: string,
  action: string,
  payload: Record<string, unknown>,
  clock: CommandClock = defaultCommandClock,
): EnqueueResult {
  const row = getInstanceRow(db, instanceId)
  if (!row) {
    return { ok: false, status: 404, error: 'Instance not found' }
  }

  let instanceActions: string[]
  try {
    instanceActions = JSON.parse(row.actions_json) as string[]
  } catch {
    instanceActions = []
  }

  if (!isEnqueueActionAllowed(action, instanceActions)) {
    return { ok: false, status: 400, error: 'Action not allowed for instance' }
  }

  const now = clock.now()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO commands (
       id, instance_id, action_type, payload_json, status,
       leased_until, result_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
  ).run(id, instanceId, action, JSON.stringify(payload ?? {}), now, now)

  notifyLongPollWaiters(instanceId)

  return {
    ok: true,
    command: {
      id,
      action,
      payload: payload ?? {},
      status: 'pending',
      created_at: now,
    },
  }
}

export type SubmitResultOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string }

/** Record device execution result for a leased command */
export function submitCommandResult(
  db: RelayDatabase,
  instanceId: string,
  commandId: string,
  status: CommandResultStatus,
  body: unknown | undefined,
  clock: CommandClock = defaultCommandClock,
): SubmitResultOutcome {
  expireLeasedCommands(db, clock.now())

  const row = db
    .prepare(
      `SELECT instance_id, status FROM commands WHERE id = ?`,
    )
    .get(commandId) as { instance_id: string; status: string } | undefined

  if (!row || row.instance_id !== instanceId) {
    return { ok: false, status: 404, error: 'Command not found' }
  }
  if (row.status !== 'leased') {
    return { ok: false, status: 409, error: 'Command not in leased state' }
  }

  const now = clock.now()
  const resultJson = body === undefined ? null : JSON.stringify(body)
  db.prepare(
    `UPDATE commands
     SET status = ?, result_json = ?, leased_until = NULL, updated_at = ?
     WHERE id = ? AND instance_id = ?`,
  ).run(status, resultJson, now, commandId, instanceId)

  return { ok: true }
}

/** Reset long-poll waiters (tests only) */
export function resetLongPollWaitersForTests(): void {
  waitersByInstance.clear()
}
