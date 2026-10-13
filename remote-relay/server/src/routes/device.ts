import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { RelayDatabase } from '../db.js'
import type { LoginRateLimiter } from '../auth/rateLimit.js'
import {
  type InstanceAuthedRequest,
  instanceClientIp,
  parseInstanceCredentials,
  recordHeartbeat,
  registerInstance,
  requireInstanceAuth,
} from '../auth/instance.js'
import { routeParam } from '../params.js'
import {
  DEFAULT_LONG_POLL_WAIT_MS,
  longPollCommands,
  submitCommandResult,
  type CommandResultStatus,
} from '../commands.js'
import {
  upsertAgentsMirror,
  upsertMessagesMirror,
  upsertTasksMirror,
} from '../mirror.js'

const registerBodySchema = z.object({
  instance_id: z.string().min(1),
  display_name: z.string().min(1),
  password: z.string().min(1),
  registry_version: z.number().int().positive(),
  actions: z.array(z.string()),
})

const heartbeatBodySchema = z.object({
  registry_version: z.number().int().positive().optional(),
  actions: z.array(z.string()).optional(),
})

const commandResultBodySchema = z.object({
  status: z.enum(['done', 'error', 'rejected']),
  body: z.unknown().optional(),
})

const mirrorAgentItemSchema = z.object({
  agent_id: z.string().min(1),
  display_name: z.string().nullable().optional(),
  engine: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  payload: z.record(z.unknown()).optional(),
})

const agentsSnapshotBodySchema = z.object({
  agents: z.array(mirrorAgentItemSchema).min(1),
})

const mirrorTaskItemSchema = z.object({
  agent_id: z.string().min(1),
  task_id: z.string().min(1),
  status: z.string().nullable().optional(),
  payload: z.record(z.unknown()).optional(),
})

const tasksSnapshotBodySchema = z.object({
  tasks: z.array(mirrorTaskItemSchema).min(1),
})

const mirrorMessageItemSchema = z.object({
  message_id: z.string().min(1),
  agent_id: z.string().min(1),
  role: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  created_at: z.number().int().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
})

const messagesSnapshotBodySchema = z.object({
  messages: z.array(mirrorMessageItemSchema).min(1),
})

/** Mount device register and heartbeat routes */
export function createDeviceRouter(
  db: RelayDatabase,
  instanceRateLimiter: LoginRateLimiter,
  registerRateLimiter: LoginRateLimiter,
): Router {
  const router = express.Router()

  router.post('/register', (req: Request, res: Response) => {
    const ip = instanceClientIp(req)
    const registerKey = `register:${ip}`
    const now = Date.now()
    if (registerRateLimiter.isThrottled(registerKey, now)) {
      res.status(429).json({ error: 'Too many requests' })
      return
    }
    registerRateLimiter.recordAttempt(registerKey, now)

    const parsed = registerBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid register payload' })
      return
    }
    const bootstrapHeader = req.headers['x-relay-bootstrap-token']
    const result = registerInstance(db, parsed.data, {
      ip,
      priorCredentials: parseInstanceCredentials(req),
      bootstrapToken: typeof bootstrapHeader === 'string' ? bootstrapHeader : undefined,
    })
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ ok: true })
  })

  router.post('/heartbeat', requireInstanceAuth(db, instanceRateLimiter), (req: Request, res: Response) => {
    const auth = (req as InstanceAuthedRequest).instanceAuth
    const parsed = heartbeatBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid heartbeat payload' })
      return
    }

    recordHeartbeat(db, auth.instanceId, {
      registry_version: parsed.data.registry_version,
      actions: parsed.data.actions,
    })
    res.json({ ok: true })
  })

  router.get(
    '/commands/long-poll',
    requireInstanceAuth(db, instanceRateLimiter),
    async (req: Request, res: Response) => {
      const auth = (req as InstanceAuthedRequest).instanceAuth
      const rawWait = req.query.wait_ms
      let waitMs = DEFAULT_LONG_POLL_WAIT_MS
      if (typeof rawWait === 'string' && rawWait.trim()) {
        const parsed = Number.parseInt(rawWait, 10)
        if (!Number.isFinite(parsed) || parsed < 0) {
          res.status(400).json({ error: 'Invalid wait_ms' })
          return
        }
        waitMs = parsed
      }

      try {
        const commands = await longPollCommands(db, auth.instanceId, waitMs)
        res.json({ commands })
      } catch {
        res.status(500).json({ error: 'Long poll failed' })
      }
    },
  )

  router.post(
    '/snapshot/agents',
    requireInstanceAuth(db, instanceRateLimiter),
    (req: Request, res: Response) => {
      const auth = (req as InstanceAuthedRequest).instanceAuth
      const parsed = agentsSnapshotBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid agents snapshot payload' })
        return
      }
      const upserted = upsertAgentsMirror(
        db,
        auth.instanceId,
        parsed.data.agents,
        Date.now(),
      )
      res.json({ ok: true, upserted })
    },
  )

  router.post(
    '/snapshot/tasks',
    requireInstanceAuth(db, instanceRateLimiter),
    (req: Request, res: Response) => {
      const auth = (req as InstanceAuthedRequest).instanceAuth
      const parsed = tasksSnapshotBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid tasks snapshot payload' })
        return
      }
      const upserted = upsertTasksMirror(
        db,
        auth.instanceId,
        parsed.data.tasks,
        Date.now(),
      )
      res.json({ ok: true, upserted })
    },
  )

  router.post(
    '/snapshot/messages',
    requireInstanceAuth(db, instanceRateLimiter),
    (req: Request, res: Response) => {
      const auth = (req as InstanceAuthedRequest).instanceAuth
      const parsed = messagesSnapshotBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid messages snapshot payload' })
        return
      }
      const upserted = upsertMessagesMirror(
        db,
        auth.instanceId,
        parsed.data.messages,
        Date.now(),
      )
      res.json({ ok: true, upserted })
    },
  )

  router.post(
    '/commands/:id/result',
    requireInstanceAuth(db, instanceRateLimiter),
    (req: Request, res: Response) => {
      const auth = (req as InstanceAuthedRequest).instanceAuth
      const commandId = routeParam(req.params.id)
      if (!commandId) {
        res.status(400).json({ error: 'Invalid command id' })
        return
      }
      const parsed = commandResultBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid result payload' })
        return
      }
      const outcome = submitCommandResult(
        db,
        auth.instanceId,
        commandId,
        parsed.data.status as CommandResultStatus,
        parsed.data.body,
      )
      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error })
        return
      }
      res.json({ ok: true })
    },
  )

  return router
}
