import express, { type Request, type Response, type Router } from 'express'
import type { RelayDatabase } from '../db.js'
import { verifySiteToken } from '../auth/site.js'
import {
  loadChangelogEntries,
  loadPackageVersion,
  pageChangelog,
} from '../changelog.js'

/** Extract bearer token from Authorization header */
function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null
  const token = match?.[1]?.trim()
  return token || null
}

/** Site JWT required for meta endpoints */
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

/** Version + changelog cursor APIs */
export function createMetaRouter(db: RelayDatabase): Router {
  const router = express.Router()
  const guard = requireSiteAuth(db)

  router.get('/version', guard, (_req: Request, res: Response) => {
    res.json({ version: loadPackageVersion() })
  })

  router.get('/changelog', guard, (req: Request, res: Response) => {
    const cursorRaw = req.query.cursor
    const cursor =
      typeof cursorRaw === 'string' && cursorRaw.trim() ? cursorRaw.trim() : undefined
    let limit = 10
    const limitRaw = req.query.limit
    if (typeof limitRaw === 'string' && limitRaw.trim()) {
      const n = Number.parseInt(limitRaw, 10)
      if (!Number.isFinite(n) || n < 1) {
        res.status(400).json({ error: 'Invalid limit' })
        return
      }
      limit = n
    }
    const entries = loadChangelogEntries()
    res.json(pageChangelog(entries, cursor, limit))
  })

  return router
}
