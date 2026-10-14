# Atolla Remote Relay

Lightweight Node.js + TypeScript + SQLite relay for read-only mobile access to Atolla instances on Mac.

## Layout

- `server/` — HTTP API (Express, better-sqlite3)
- `web/` — React mobile UI (later tasks)
- `deploy/` — install scripts (later tasks)

## Quick start (development)

本机一键（API `:3080` + 手机端 Vite `:15174`）：

```bash
# 仓库根
scripts/start-remote-relay.sh

# 或在 remote-relay/
npm run dev:local
# 仅 API:  ./scripts/dev-local.sh --api
# 清空库:  ./scripts/dev-local.sh --fresh
```

默认门禁密码 `localdev`，JWT 密钥 `local-dev-jwt-secret-change-me`（可用环境变量或 `remote-relay/.env` 覆盖）。

手动拆开启动：

```bash
cd remote-relay
npm install
cd server
SITE_PASSWORD=your-gate-password RELAY_JWT_SECRET=devsecret npm run dev
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
| `RELAY_INSTANCE_BOOTSTRAP_TOKEN` | Optional. When set, **first** `POST /api/device/register` for a new `instance_id` must send header `X-Relay-Bootstrap-Token` with this value. Password rotation for an existing instance requires `X-Instance-Id` + `X-Instance-Password` (current password) and a new `password` in the JSON body. Register is rate-limited per IP. |

Mac bridge config (`.atolla/remote-relay.json`) assigns a random UUID `instance_id` on first create; keep it stable across restarts.

## Monorepo scripts (from `remote-relay/`)

- `npm run dev` — run server with hot reload
- `npm run build` — compile TypeScript
- `npm run start` — run compiled `dist/index.js`

See [design spec](../docs/superpowers/specs/2026-10-13-remote-relay-design.md) for full architecture.
