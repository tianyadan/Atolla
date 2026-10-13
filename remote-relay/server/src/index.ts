import { createApp } from './app.js'
import { initDb } from './db.js'

const PORT = Number(process.env.PORT ?? 3080)

/** Start HTTP API (health + site gate auth) */
function main(): void {
  const db = initDb()
  const app = createApp(db)

  app.listen(PORT, () => {
    console.log(`[remote-relay] listening on http://0.0.0.0:${PORT}`)
  })
}

main()
