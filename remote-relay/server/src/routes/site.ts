import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { RelayDatabase } from '../db.js'
import { verifySiteToken } from '../auth/site.js'
import { listInstancesPublic, revokeInstancePassword } from '../auth/instance.js'
import { enqueueCommand } from '../commands.js'
import {
  listAgentsMirror,
  listMessagesMirror,
  listTasksMirror,
  normalizeMessagesLimit,
} from '../mirror.js'
import { routeParam } from '../params.js'

const enqueueBodySchema = z.object({
  action: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
})

const syncMessagesBodySchema = z.object({
  before_id: z.string().optional(),
  limit: z.number().int().positive().optional(),
})

/** Extract bearer token from Authorization header */
function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null
  const token = match?.[1]?.trim()
  return token || null
}

/** Require valid site gate JWT */
function requireSiteAuth(db: RelayDatabase) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const token = readBearerToken(req)
    if (!token || !verifySiteToken(db, token)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  }
}

/** Mount site-facing instance list and revoke routes */
export function createSiteRouter(db: RelayDatabase): Router {
  const router = express.Router()
  const guard = requireSiteAuth(db)

  router.get('/instances', guard, (_req: Request, res: Response) => {
    res.json({ instances: listInstancesPublic(db) })
  })

  router.post('/instances/:id/commands', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const parsed = enqueueBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid command payload' })
      return
    }
    const result = enqueueCommand(
      db,
      instanceId,
      parsed.data.action,
      parsed.data.payload ?? {},
    )
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ command: result.command })
  })

  router.get('/instances/:id/agents', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const result = listAgentsMirror(db, instanceId)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ agents: result.agents })
  })

  router.get('/instances/:id/agents/:agentId/tasks', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    const agentId = routeParam(req.params.agentId)
    if (!instanceId || !agentId) {
      res.status(400).json({ error: 'Invalid instance or agent id' })
      return
    }
    const result = listTasksMirror(db, instanceId, agentId)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ tasks: result.tasks })
  })

  router.get('/instances/:id/agents/:agentId/messages', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    const agentId = routeParam(req.params.agentId)
    if (!instanceId || !agentId) {
      res.status(400).json({ error: 'Invalid instance or agent id' })
      return
    }
    const beforeRaw = req.query.before_id
    const beforeId = typeof beforeRaw === 'string' && beforeRaw.trim() ? beforeRaw.trim() : undefined
    const limitRaw = req.query.limit
    let limit: number | undefined
    if (typeof limitRaw === 'string' && limitRaw.trim()) {
      const parsed = Number.parseInt(limitRaw, 10)
      if (!Number.isFinite(parsed)) {
        res.status(400).json({ error: 'Invalid limit' })
        return
      }
      limit = parsed
    }
    const result = listMessagesMirror(
      db,
      instanceId,
      agentId,
      beforeId,
      normalizeMessagesLimit(limit),
    )
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json(result.page)
  })

  router.post(
    '/instances/:id/agents/:agentId/sync-messages',
    guard,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = syncMessagesBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid sync-messages payload' })
        return
      }
      const payload: Record<string, unknown> = { agent_id: agentId }
      if (parsed.data.before_id?.trim()) payload.before_id = parsed.data.before_id.trim()
      if (parsed.data.limit != null) payload.limit = parsed.data.limit

      const result = enqueueCommand(db, instanceId, 'sync.messages', payload)
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  router.delete('/instances/:id/password', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const ok = revokeInstancePassword(db, instanceId)
    if (!ok) {
      res.status(404).json({ error: 'Instance not found' })
      return
    }
    res.json({ ok: true })
  })

  return router
}
