import cors from 'cors'
import express, { type Express } from 'express'
import type { RelayDatabase } from './db.js'
import { LoginRateLimiter } from './auth/rateLimit.js'
import { createSiteAuthRouter } from './routes/siteAuth.js'

/** Build Express app with health and site auth routes */
export function createApp(db: RelayDatabase): Express {
  const app = express()
  const rateLimiter = new LoginRateLimiter()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'atolla-remote-relay', ts: Date.now() })
  })

  app.use('/api/auth', createSiteAuthRouter(db, rateLimiter))

  return app
}
