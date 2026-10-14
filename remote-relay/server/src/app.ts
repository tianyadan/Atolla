import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express, { type Express } from 'express'
import type { RelayDatabase } from './db.js'
import { LoginRateLimiter } from './auth/rateLimit.js'
import { FailLockLimiter } from './auth/failLock.js'
import { UNLOCK_LOCK_MS, UNLOCK_MAX_FAILURES } from './auth/unlock.js'
import { isRelayTrustProxyEnabled } from './auth/site.js'
import { createSiteAuthRouter } from './routes/siteAuth.js'
import { createDeviceRouter } from './routes/device.js'
import { createSiteRouter } from './routes/site.js'
import { createMetaRouter } from './routes/meta.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

/** Locate Vite build output relative to server src/dist or monorepo cwd */
function resolveWebDistDir(): string | null {
  const candidates = [
    path.resolve(moduleDir, '../../web/dist'),
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir
  }
  return null
}

/** Serve mobile UI static assets; SPA fallback for non-API GET */
function attachWebUi(app: Express): void {
  const dist = resolveWebDistDir()
  if (!dist) {
    console.warn(
      '[remote-relay] web/dist not found — API only. Build the UI: cd remote-relay/web && npm run build',
    )
    return
  }

  app.use(express.static(dist, { index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

/** Build Express app with health and site auth routes */
export function createApp(db: RelayDatabase): Express {
  const app = express()
  if (isRelayTrustProxyEnabled()) {
    app.set('trust proxy', 1)
  }
  const siteLoginRateLimiter = new LoginRateLimiter()
  const instanceAuthRateLimiter = new LoginRateLimiter()
  const registerRateLimiter = new LoginRateLimiter()
  const unlockFailLock = new FailLockLimiter(UNLOCK_MAX_FAILURES, UNLOCK_LOCK_MS)

  app.use(cors())
  app.use(express.json({ limit: '5mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'atolla-remote-relay', ts: Date.now() })
  })

  app.use('/api/auth', createSiteAuthRouter(db, siteLoginRateLimiter))
  app.use(
    '/api/device',
    createDeviceRouter(db, instanceAuthRateLimiter, registerRateLimiter),
  )
  app.use('/api/meta', createMetaRouter(db))
  app.use('/api', createSiteRouter(db, unlockFailLock))

  attachWebUi(app)

  return app
}
