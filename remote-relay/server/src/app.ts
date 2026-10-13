import cors from 'cors'
import express, { type Express } from 'express'
import type { RelayDatabase } from './db.js'
import { LoginRateLimiter } from './auth/rateLimit.js'
import { isRelayTrustProxyEnabled } from './auth/site.js'
import { createSiteAuthRouter } from './routes/siteAuth.js'
import { createDeviceRouter } from './routes/device.js'
import { createSiteRouter } from './routes/site.js'

/** Build Express app with health and site auth routes */
export function createApp(db: RelayDatabase): Express {
  const app = express()
  if (isRelayTrustProxyEnabled()) {
    app.set('trust proxy', 1)
  }
  const siteLoginRateLimiter = new LoginRateLimiter()
  const instanceAuthRateLimiter = new LoginRateLimiter()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'atolla-remote-relay', ts: Date.now() })
  })

  app.use('/api/auth', createSiteAuthRouter(db, siteLoginRateLimiter))
  app.use('/api/device', createDeviceRouter(db, instanceAuthRateLimiter))
  app.use('/api', createSiteRouter(db))

  return app
}
