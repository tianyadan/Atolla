import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { RelayDatabase } from '../db.js'
import {
  loginSite,
  resolveClientIp,
  verifySiteToken,
} from '../auth/site.js'
import type { LoginRateLimiter } from '../auth/rateLimit.js'

const loginBodySchema = z.object({
  password: z.string().min(1),
})

/** Mount site gate login and session routes */
export function createSiteAuthRouter(
  db: RelayDatabase,
  rateLimiter: LoginRateLimiter,
): Router {
  const router = express.Router()

  router.post('/login', (req: Request, res: Response) => {
    const parsed = loginBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(401).json({ error: '账号或密码错误' })
      return
    }

    const ip = resolveClientIp(
      req.headers['x-forwarded-for'],
      req.socket.remoteAddress,
    )
    const result = loginSite(db, rateLimiter, parsed.data.password, ip)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ token: result.token })
  })

  router.get('/me', (req: Request, res: Response) => {
    const header = req.headers.authorization
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null
    const token = match?.[1]?.trim()
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    const payload = verifySiteToken(db, token)
    if (!payload) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    res.json({ ok: true, sub: payload.sub, tokenVersion: payload.token_version })
  })

  return router
}
