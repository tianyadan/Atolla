import cors from 'cors'
import express from 'express'
import { initDb } from './db.js'

const PORT = Number(process.env.PORT ?? 3080)

/** Start HTTP API (health + DB bootstrap only in V1 task 1) */
function main(): void {
  initDb()

  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'atolla-remote-relay', ts: Date.now() })
  })

  app.listen(PORT, () => {
    console.log(`[remote-relay] listening on http://0.0.0.0:${PORT}`)
  })
}

main()
