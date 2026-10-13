import express, { type Request, type Response, type Router } from 'express'
import type { RelayDatabase } from '../db.js'
import { verifySiteToken } from '../auth/site.js'
import { listInstancesPublic, revokeInstancePassword } from '../auth/instance.js'

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

  router.delete('/instances/:id/password', guard, (req: Request, res: Response) => {
    const instanceId = req.params.id?.trim()
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
