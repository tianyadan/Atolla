# Atolla

Local-first platform for running a fleet of **digital colleague agents** backed by CLI engines (Claude / Codex / Cursor Agent).  
Go backend + React admin UI + MySQL. Agents work in authorized workspaces with tool-permission gates, occupancy control, and optional team workflows.

## Features (current, ~v0.2.17)

- **Home chat / receptionist** — Streaming Q&A over allowlisted workspaces; visitor cookie; optional read-only DB query via backend APIs. Product name: **Atolla**.
- **Managed agents** — Create agents with engine, binary path, rules prompt, workspace binding, and policy flags (write / network / rm / browser).
- **Engine adapters** — Claude (`claude -p` stream-json + `--resume`), Codex (`codex exec --json` + thread resume), Cursor Agent (generic CLI).
- **Permission proxy** — PreToolUse hook → backend classifier → browser approve/deny; session-level AI auto-review; Bark notify optional.
- **Cross-agent invoke** — `@mention` other agents; isolated runs with quotes back into the caller timeline.
- **Team workflows** — Visual DAG (React Flow): sequence, parallel, merge, condition, human review, retry; occupancy so one agent has one primary task.
- **Ops** — Admin login (JWT), conversation history, stats, command audits, agent folders, status snapshots, context/token indicators, changelog menu.
- **External task progress** — Public `POST/GET /api/agents/tasks` for other tools to report progress.

## Stack

| Layer | Choice |
|-------|--------|
| Backend | Go, Gin |
| Frontend | React, Vite |
| DB | MySQL 8 (Docker, host port `3307`) |
| Engines | Local CLIs: `claude`, `codex`, Cursor `agent` |

## Architecture

对话和员工提问用 SSE 推流。Mac 到 Remote Relay 是 HTTP 长轮询。代码里没有 WebSocket。

![Atolla 系统架构](docs/architecture/atolla-architecture.png)

交互图：[docs/architecture/atolla-architecture.html](docs/architecture/atolla-architecture.html)

### 提问数据流

浏览器 `POST /api/question` 或管理端 `POST /api/admin/agents/:id/ask`，Gin 用 `text/event-stream` 回写。员工提问先占住该员工（`TryAcquireOccupancy`），再进 `askManagedCore`。引擎在 `invoke.go` 按 `claude` / `codex` / 其它 CLI 分发：Claude 走 `claude -p` 流式 JSON，Codex 走 `codex exec --json`，Cursor Agent 走 `agent -p`。回复写入 MySQL `messages`，成功后 Mac 桥把该员工消息快照推到 Remote Relay。上下文优先用引擎自己的 session resume，不再把整段平台历史塞进提示词。

### 工具授权

引擎的 PreToolUse 调 `avatar-hook`。hook `POST /api/permissions/request`，`HandlePermissionRequest` 分类后要么自动放行，要么等管理端裁决。裁决结果从 hook 的 stdout 回到 CLI。压缩事件走同一条 hook，用来同步清平台对话。

### 项目协作

`POST /api/admin/workflows/:id/runs` 调用 `StartWorkflowRun`。定义存在 MySQL，图在进程内的 `WorkflowEngine` 里异步跑。节点类型是 `agent`、`parallel`、`merge`、`condition`、`human_review`/`review`、`end`。启动前查占用；冲突员工默认拒绝启动，`forceTakeover` 才会先打断。协作节点用 `AskManagedIsolated`，不改员工主会话。

### 管理端配置面

这些接口都挂在 JWT 管理路由上，不进上面的主链路：人才市场聘用、技能安装、员工数据库源、服务器源、browser-use 安装检查。外部进度上报是公开的 `POST/GET /api/agents/tasks`。

## Layout

```
Atolla/
├── db/                 # schema + versioned migrations
├── docker-compose.yml  # MySQL
├── docs/plan/          # feature design notes
├── docs/superpowers/   # specs & implementation plans
├── scripts/            # start / restart / shutdown / Bark notify
├── server/             # Go API + avatar-hook
└── web/                # React admin + home chat
```

## Quick start

Prerequisites: Docker, Go 1.22+, Node.js 20+, and at least one engine CLI on `PATH`.

```bash
# MySQL + API (:8080) + Vite (:5173)
./scripts/start.sh

# Skip Docker if MySQL is already up
./scripts/start.sh --skip-db
```

Open `http://localhost:5173`. Admin console requires login (see env below).

Other helpers: `./scripts/restart.sh`, `./scripts/shutdown.sh`.

## Configuration

Set via environment (defaults are also applied in `scripts/start.sh`). **Override all secrets in production.**

| Variable | Purpose | Typical default |
|----------|---------|-----------------|
| `AVATAR_ADDR` | HTTP listen address | `:8080` |
| `AVATAR_DB_DSN` | App MySQL DSN | `root:root@tcp(127.0.0.1:3307)/colleague_avatar?...` |
| `AVATAR_DATA_DB_DSN` | Optional read-only data DB (empty = disabled) | _(empty)_ |
| `AVATAR_ALLOWED_IPS` | Client IP allowlist (comma-separated; empty may allow all depending on auth path) | `127.0.0.1` |
| `AVATAR_WORKSPACE_ROOT` | Root for resolving allowlisted workspaces | _(set to your machine)_ |
| `AVATAR_CLAUDE_BIN` | Claude CLI path | `claude` |
| `AVATAR_TIMEOUT_SEC` | Per-ask timeout (seconds) | `28800` |
| `AVATAR_PERMISSION_ENABLED` | Tool permission proxy (`0` = off) | `1` |
| `AVATAR_PERMISSION_WAIT_SEC` | Seconds to wait for human decide | `120` |
| `AVATAR_REVIEW_TIMEOUT_SEC` | Auto-reviewer timeout | `20` |
| `AVATAR_HOOK_BIN` | PreToolUse hook binary | `server/bin/avatar-hook` (built by start script) |
| `AVATAR_BACKEND_URL` | URL hook uses to reach the API | `http://127.0.0.1:8080` |
| `AVATAR_ADMIN_USER` / `AVATAR_ADMIN_PASS` | Admin console credentials | _(change me)_ |
| `AVATAR_JWT_SECRET` | HS256 secret for admin JWT | _(change me)_ |
| `AVATAR_JWT_TTL_HOURS` | Admin token TTL | `168` |
| `AVATAR_BARK_NOTIFY` | Push pending-permission alerts | `1` |
| `AVATAR_NOTIFY_SCRIPT` | Bark helper script | `scripts/notify-permission.sh` |
| `BARK_KEY` | Bark device key (if notify enabled) | _(optional)_ |
| `AVATAR_OSS_ENDPOINT` | Aliyun OSS endpoint (upload) | e.g. `oss-cn-qingdao.aliyuncs.com` |
| `AVATAR_OSS_ACCESS_KEY_ID` / `AVATAR_OSS_ACCESS_KEY_SECRET` | OSS credentials | _(in local `.env` only)_ |
| `AVATAR_OSS_BUCKET` | OSS bucket | `digital-employee-qd` |
| `AVATAR_OSS_PREFIX` | Object key prefix | `avatars/` |
| `AVATAR_OSS_PUBLIC_BASE` | Public URL base（须 HTTPS 证书匹配；自定义域未绑证时用官方桶域名） | `https://digital-employee-qd.oss-cn-qingdao.aliyuncs.com` |

Copy `.env.example` → `.env` for local secrets. `scripts/start.sh` auto-loads `.env`.

## Permission flow

```
engine CLI ──PreToolUse hook──▶ avatar-hook ──POST /api/permissions/request──▶ classifier
                                                                              │ ask
   hook stdout ◀── decide ◀── Hub.Wait ◀── /api/permissions/decide ◀── SSE ── browser
                                 │
                                 └─(auto on)→ Reviewer → ALLOW or fall back to modal
```

`--permission-prompt-tool` is not used: it needs a connected MCP tool; a bare subprocess would silently deny. PreToolUse hooks are the controllable entry point.

## API surface (high level)

**Public / LAN**

- `POST /api/question` — SSE home chat
- `POST /api/conversations`, `GET /api/workspaces`
- `POST|GET /api/agents/tasks`, `GET /api/agents/task-types`
- `POST /api/auth/login`

**Admin (JWT)**

- Conversations, stats, commands
- `/api/admin/agents*` — CRUD, ask/stop/new/compress, folders, status/context, audits
- `/api/admin/workflows*` — CRUD, runs, retry/resume/review, permission pending
- Test-server helpers (restricted by IP)

`GET /health` — liveness

## Security notes

- Prefer least privilege: bind workspaces, disable write/network/rm/browser unless needed.
- Treat user messages as untrusted data (prompt-injection resistant prompts in home agent).
- Configure `AVATAR_ALLOWED_IPS` for any non-localhost exposure.
- Never commit real `.env` secrets; rotate default JWT / admin passwords before sharing a host.

## License

See [LICENSE](./LICENSE) in this repository.
