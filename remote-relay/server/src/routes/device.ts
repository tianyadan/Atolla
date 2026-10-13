import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { RelayDatabase } from '../db.js'
import type { LoginRateLimiter } from '../auth/rateLimit.js'
import {
  authenticateInstance,
  instanceClientIp,
  parseInstanceCredentials,
  recordHeartbeat,
  registerInstance,
} from '../auth/instance.js'

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

/** Mount device register and heartbeat routes */
export function createDeviceRouter(
  db: RelayDatabase,
  instanceRateLimiter: LoginRateLimiter,
): Router {
  const router = express.Router()

  router.post('/register', (req: Request, res: Response) => {
    const parsed = registerBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid register payload' })
      return
    }
    const result = registerInstance(db, parsed.data)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ ok: true })
  })

  router.post('/heartbeat', (req: Request, res: Response) => {
    const creds = parseInstanceCredentials(req)
    if (!creds) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const ip = instanceClientIp(req)
    const auth = authenticateInstance(
      db,
      instanceRateLimiter,
      creds.instanceId,
      creds.password,
      ip,
    )
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

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

  return router
}
