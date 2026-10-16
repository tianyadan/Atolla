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
/** Waiters for a specific command reaching a terminal status */
const waitersByCommandId = new Map<string, Set<() => void>>()

const TERMINAL_COMMAND_STATUSES = new Set([
  'done',
  'error',
  'rejected',
  'expired',
])

/** Wake long-poll waiters after a new command is enqueued */
function notifyLongPollWaiters(instanceId: string): void {
  const waiters = waitersByInstance.get(instanceId)
  if (!waiters?.size) return
  for (const wake of waiters) wake()
  waiters.clear()
}

/** Wake callers waiting on enqueueAndWait for this command */
function notifyCommandResultWaiters(commandId: string): void {
  const waiters = waitersByCommandId.get(commandId)
  if (!waiters?.size) return
  for (const wake of waiters) wake()
  waiters.clear()
  waitersByCommandId.delete(commandId)
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

  notifyCommandResultWaiters(commandId)
  return { ok: true }
}

export type EnqueueAndWaitResult =
  | { ok: true; status: 'done'; body: unknown }
  | { ok: false; httpStatus: number; error: string; commandStatus?: string }

/** Default timeout for mobile settings RPC (ms) */
export const DEFAULT_ENQUEUE_WAIT_MS = 35_000

/** Read command row status + result */
function readCommandOutcome(
  db: RelayDatabase,
  commandId: string,
): { status: string; result_json: string | null } | undefined {
  return db
    .prepare(`SELECT status, result_json FROM commands WHERE id = ?`)
    .get(commandId) as { status: string; result_json: string | null } | undefined
}

/** Wait until command reaches a terminal status or timeout */
async function waitCommandTerminal(
  db: RelayDatabase,
  commandId: string,
  timeoutMs: number,
  clock: CommandClock,
): Promise<{ status: string; result_json: string | null } | undefined> {
  const safeWait = Math.max(0, Math.min(timeoutMs, 120_000))
  const deadline = clock.now() + safeWait

  let row = readCommandOutcome(db, commandId)
  if (row && TERMINAL_COMMAND_STATUSES.has(row.status)) return row

  while (clock.now() < deadline) {
    expireLeasedCommands(db, clock.now())
    row = readCommandOutcome(db, commandId)
    if (row && TERMINAL_COMMAND_STATUSES.has(row.status)) return row

    const remaining = deadline - clock.now()
    if (remaining <= 0) break

    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const timer = setTimeout(finish, remaining)
      let set = waitersByCommandId.get(commandId)
      if (!set) {
        set = new Set()
        waitersByCommandId.set(commandId, set)
      }
      const wake = () => {
        clearTimeout(timer)
        set!.delete(wake)
        finish()
      }
      set.add(wake)
    })

    row = readCommandOutcome(db, commandId)
    if (row && TERMINAL_COMMAND_STATUSES.has(row.status)) return row
  }

  return readCommandOutcome(db, commandId)
}

/**
 * Enqueue an action and wait for Mac result (settings / skills RPC).
 * Ask/stop remain fire-and-forget via enqueueCommand alone.
 */
export async function enqueueAndWait(
  db: RelayDatabase,
  instanceId: string,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs: number = DEFAULT_ENQUEUE_WAIT_MS,
  clock: CommandClock = defaultCommandClock,
): Promise<EnqueueAndWaitResult> {
  const enq = enqueueCommand(db, instanceId, action, payload, clock)
  if (!enq.ok) {
    return { ok: false, httpStatus: enq.status, error: enq.error }
  }

  const outcome = await waitCommandTerminal(db, enq.command.id, timeoutMs, clock)
  if (!outcome || !TERMINAL_COMMAND_STATUSES.has(outcome.status)) {
    return {
      ok: false,
      httpStatus: 504,
      error: 'Mac 未在时限内响应，请确认本机 Atolla 在线后重试',
      commandStatus: outcome?.status,
    }
  }

  if (outcome.status !== 'done') {
    let errMsg = `命令失败: ${outcome.status}`
    if (outcome.result_json) {
      try {
        const parsed = JSON.parse(outcome.result_json) as { error?: string; message?: string }
        errMsg = parsed.error || parsed.message || errMsg
      } catch {
        /* keep default */
      }
    }
    return {
      ok: false,
      httpStatus: 502,
      error: errMsg,
      commandStatus: outcome.status,
    }
  }

  let body: unknown = null
  if (outcome.result_json) {
    try {
      body = JSON.parse(outcome.result_json)
    } catch {
      body = outcome.result_json
    }
  }
  return { ok: true, status: 'done', body }
}

/** Reset long-poll waiters (tests only) */
export function resetLongPollWaitersForTests(): void {
  waitersByInstance.clear()
  waitersByCommandId.clear()
}
