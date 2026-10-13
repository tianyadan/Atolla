# Atolla Remote Relay

Lightweight Node.js + TypeScript + SQLite relay for read-only mobile access to Atolla instances on Mac.

## Layout

- `server/` — HTTP API (Express, better-sqlite3)
- `web/` — React mobile UI (later tasks)
- `deploy/` — install scripts (later tasks)

## Quick start (development)

```bash
cd remote-relay
npm install
cd server
SITE_PASSWORD=your-gate-password npm run dev
```

Default listen port: **3080** (`PORT` to override). SQLite file: `server/data/relay.db` (`SQLITE_PATH` to override).

Health check:

```bash
curl http://localhost:3080/api/health
```

On first boot, if `site_auth` has no row, `SITE_PASSWORD` is hashed with bcrypt (cost 12) and stored; the env var is cleared in-process after bootstrap.

### Site auth environment

| Variable | Purpose |
|----------|---------|
| `RELAY_JWT_SECRET` | HS256 signing secret. **Required** when `NODE_ENV=production`; dev/test may omit (uses an insecure default). |
| `RELAY_JWT_TTL_HOURS` | JWT lifetime in hours (default 24). |
| `RELAY_TRUST_PROXY` | Set to `1` or `true` only when this process sits **behind a trusted reverse proxy** (nginx, Caddy, etc.). Enables Express `trust proxy` so `req.ip` reflects the proxy’s `X-Forwarded-For`. If unset, client IP for login rate limits comes from the TCP socket only—**spoofed `X-Forwarded-For` headers are ignored**. |

## Monorepo scripts (from `remote-relay/`)

- `npm run dev` — run server with hot reload
- `npm run build` — compile TypeScript
- `npm run start` — run compiled `dist/index.js`

See [design spec](../docs/superpowers/specs/2026-10-13-remote-relay-design.md) for full architecture.
