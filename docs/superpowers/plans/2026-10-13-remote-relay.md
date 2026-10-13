# Atolla Remote Relay (remote-relay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地仓内轻量远程中继：多 Mac 实例注册、长轮询指令箱、Hybrid 镜像同步；V1 手机端只读查看数字人/任务/聊天历史；管理台可配中继并一键部署。

**Architecture:** `remote-relay/`（Node+TS+SQLite+React）独立进程部署在服务器；Atolla Go 内嵌 `RemoteBridge` 出站注册/心跳/长轮询/推镜像并执行 ActionRegistry；管理台菜单配置 URL 与 6 位实例密码。服务器永不主动连 Mac。

**Tech Stack:** Node.js 20+、TypeScript、better-sqlite3（或 `node:sqlite`）、Express/Fastify、React+Vite+TS、Go（现有 Atolla server）、systemd + shell 部署脚本

**Spec:** [docs/superpowers/specs/2026-10-13-remote-relay-design.md](../specs/2026-10-13-remote-relay-design.md)

## Global Constraints

- 不强制 HTTPS；默认 `http://IP:port` 可跑通
- 网站：单站门禁密码（哈希）；实例：Mac 生成 6 位数字+英文密码，7 天有效，服务器可吊销；均只存哈希
- V1 只读；`agent.ask` / `agent.stop` 仅占位，无 handler
- 云端只能入队已声明 action；Mac 无 handler → `rejected`
- 一中继多实例；真相在 Mac，云端为镜像+信箱
- 密码/ token 不明文进 git、日志

---

## File map（锁定边界）

| 路径 | 职责 |
|---|---|
| `remote-relay/package.json` | monorepo scripts：`server` + `web` + `build` |
| `remote-relay/server/src/index.ts` | HTTP 入口 |
| `remote-relay/server/src/db.ts` | SQLite schema + 迁移 |
| `remote-relay/server/src/auth/site.ts` | 门禁哈希、JWT、限速 |
| `remote-relay/server/src/auth/instance.ts` | 实例密码哈希校验、过期 |
| `remote-relay/server/src/routes/site.ts` | 登录、实例列表、镜像读、入队 sync、吊销 |
| `remote-relay/server/src/routes/device.ts` | register/heartbeat/snapshot/long-poll/result |
| `remote-relay/server/src/commands.ts` | 队列、租约、registry 校验 |
| `remote-relay/server/src/registry.ts` | 云端已知 action 清单 `REGISTRY_VERSION=1` |
| `remote-relay/web/` | 手机端 React TS 五页 |
| `remote-relay/deploy/install.sh` | rsync + npm + systemd |
| `server/internal/remotebridge/` | Go Bridge：配置、密码生成、轮询、推送、handlers |
| `server/internal/handler/` + `web/` | 管理台「远程中继」API + UI |

---

### Task 1: Scaffold `remote-relay` + health

**Files:**
- Create: `remote-relay/package.json`
- Create: `remote-relay/server/package.json`
- Create: `remote-relay/server/tsconfig.json`
- Create: `remote-relay/server/src/index.ts`
- Create: `remote-relay/server/src/db.ts`
- Create: `remote-relay/README.md`

- [ ] **Step 1: 初始化 server 包**

`remote-relay/server/package.json` 依赖：`express`（或 `fastify`）、`better-sqlite3`、`bcryptjs`、`jsonwebtoken`、`zod`、`cors`；dev：`typescript`、`tsx`、`vitest`、`@types/node` 等。根 `package.json` 提供 `"dev": "npm run dev -w server"`、`"build"`、`"start"`。

- [ ] **Step 2: SQLite schema**

在 `db.ts` 创建表（与 spec §7 一致）：`site_auth`、`instances`、`commands`、`agents_mirror`、`tasks_mirror`、`messages_mirror`、`audit_logs`。首次启动若无门禁行，从 env `SITE_PASSWORD` 写入哈希后清除明文依赖（仅 bootstrap）。

- [ ] **Step 3: Health 路由**

```ts
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'atolla-remote-relay', ts: Date.now() })
})
```

- [ ] **Step 4: 本地启动验证**

Run: `cd remote-relay/server && SITE_PASSWORD=testpass npm run dev`  
Expected: 监听 `3080`（可配置），`curl localhost:3080/api/health` → `{"ok":true,...}`

- [ ] **Step 5: Commit**

```bash
git add remote-relay
git commit -m "feat(remote-relay): scaffold Node server and SQLite schema"
```

---

### Task 2: 网站门禁 + 防爆破

**Files:**
- Create: `remote-relay/server/src/auth/site.ts`
- Create: `remote-relay/server/src/routes/siteAuth.ts`
- Create: `remote-relay/server/src/auth/rateLimit.ts`
- Test: `remote-relay/server/src/auth/site.test.ts`

- [ ] **Step 1: 写失败测试** — 错误密码不发 JWT；连续失败触发锁定

```ts
it('rejects bad password', async () => {
  const r = await login('wrong')
  expect(r.status).toBe(401)
})
```

- [ ] **Step 2: 实现** — `bcrypt`/`argon2` 校验；JWT 含 `token_version`；按 IP 计数，超过阈值（如 5/分钟）或连续失败锁定 15 分钟；错误文案统一「账号或密码错误」

- [ ] **Step 3: 路由** — `POST /api/auth/login`；`GET /api/auth/me`（需 Bearer）

- [ ] **Step 4: 跑测通过 + Commit**

```bash
git commit -m "feat(remote-relay): site gate auth with rate limit"
```

---

### Task 3: 实例注册 / 心跳 / 吊销

**Files:**
- Create: `remote-relay/server/src/auth/instance.ts`
- Create: `remote-relay/server/src/routes/device.ts`（register + heartbeat）
- Modify: `remote-relay/server/src/routes/site.ts`（list + revoke）
- Test: `remote-relay/server/src/auth/instance.test.ts`

- [ ] **Step 1: 注册 API**

`POST /api/device/register` body：

```json
{
  "instance_id": "uuid-or-stable-id",
  "display_name": "Office-Mac",
  "password": "Ab12Cd",
  "registry_version": 1,
  "actions": ["ping", "sync.agents", "sync.tasks", "sync.messages"]
}
```

规则：密码必须 Mac 侧生成（服务端不生成）；存哈希；`password_expires_at = now + 7d`；同 `instance_id` 再注册 = 轮换密码。

- [ ] **Step 2: 鉴权中间件** — Header `X-Instance-Id` + `X-Instance-Password`（或 Authorization Basic）；过期/吊销/哈希不符 → 401

- [ ] **Step 3: Heartbeat** — `POST /api/device/heartbeat` 更新 `last_heartbeat_at`、可选刷新 `actions`

- [ ] **Step 4: 网站侧** — `GET /api/instances`（需门禁 JWT）；`DELETE /api/instances/:id/password` 吊销（清空哈希或设 revoked 标记）

- [ ] **Step 5: 测试 + Commit**

```bash
git commit -m "feat(remote-relay): instance register heartbeat and revoke"
```

---

### Task 4: 命令队列 + 长轮询

**Files:**
- Create: `remote-relay/server/src/registry.ts`
- Create: `remote-relay/server/src/commands.ts`
- Modify: `remote-relay/server/src/routes/device.ts`
- Modify: `remote-relay/server/src/routes/site.ts`
- Test: `remote-relay/server/src/commands.test.ts`

- [ ] **Step 1: Registry**

```ts
export const REGISTRY_VERSION = 1
export const KNOWN_ACTIONS = [
  'ping', 'sync.agents', 'sync.tasks', 'sync.messages',
  // reserved, not executable on Mac V1:
  'agent.ask', 'agent.stop',
] as const
export const V1_EXECUTABLE = new Set(['ping', 'sync.agents', 'sync.tasks', 'sync.messages'])
```

入队前：action ∈ 实例上报的 `actions` ∩ 云端允许列表。

- [ ] **Step 2: enqueue** — 网站 JWT → `POST /api/instances/:id/commands` `{ action, payload }`

- [ ] **Step 3: long-poll** — `GET /api/device/commands/long-poll?wait_ms=25000`：有 `pending` 则标 `leased`（租约 60s）并返回；否则挂起直到超时返回 `[]`

- [ ] **Step 4: result** — `POST /api/device/commands/:id/result` `{ status: 'done'|'error'|'rejected', body? }`

- [ ] **Step 5: 过期扫描** — 定时或下次 poll 时将超时 `leased` → `expired`

- [ ] **Step 6: 测试（假时钟或短 wait）+ Commit**

```bash
git commit -m "feat(remote-relay): command queue and long-poll"
```

---

### Task 5: Snapshot ingest + 镜像读 API

**Files:**
- Modify: `remote-relay/server/src/routes/device.ts`
- Modify: `remote-relay/server/src/routes/site.ts`
- Create: `remote-relay/server/src/mirror.ts`

- [ ] **Step 1: 写入镜像**

- `POST /api/device/snapshot/agents` — upsert `agents_mirror`
- `POST /api/device/snapshot/tasks` — upsert `tasks_mirror`
- `POST /api/device/snapshot/messages` — upsert by `(instance_id, message_id)`

- [ ] **Step 2: 网站只读**

- `GET /api/instances/:id/agents`
- `GET /api/instances/:id/agents/:agentId/tasks`
- `GET /api/instances/:id/agents/:agentId/messages?before_id=&limit=`

- [ ] **Step 3: 打开聊天时入队** — `POST /api/instances/:id/agents/:agentId/sync-messages` → enqueue `sync.messages`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(remote-relay): agent task message mirror APIs"
```

---

### Task 6: 手机端 React UI（V1 五页）

**Files:**
- Create: `remote-relay/web/`（Vite React TS）
- Create: pages: Login、Instances、Agents、AgentDetail、ChatHistory
- Create: `remote-relay/web/src/api.ts`

- [ ] **Step 1: Vite scaffold + 代理到 server**

- [ ] **Step 2: 登录页** — 存 JWT；失败统一提示

- [ ] **Step 3: 实例列表** — 在线（heartbeat &lt; 30s）、过期提示、吊销按钮

- [ ] **Step 4: 数字人 / 任务 / 聊天只读** — 进聊天触发 sync-messages；轮询或短间隔刷新镜像

- [ ] **Step 5: `npm run build` 由 server 托管 `web/dist` 静态资源

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(remote-relay): mobile read-only UI"
```

---

### Task 7: Go RemoteBridge + ActionRegistry

**Files:**
- Create: `server/internal/remotebridge/config.go`
- Create: `server/internal/remotebridge/password.go`
- Create: `server/internal/remotebridge/bridge.go`
- Create: `server/internal/remotebridge/handlers.go`
- Create: `server/internal/remotebridge/registry.go`
- Create: `server/internal/remotebridge/bridge_test.go`
- Modify: `server/internal/service/service.go`（启动 Bridge）
- Modify: `server/internal/handler/handler.go` + 新 handler 文件（管理 API）

- [ ] **Step 1: 密码生成**

```go
// GenerateInstancePassword 返回 6 位 [0-9A-Za-z]，不含易混字符可选
func GenerateInstancePassword() string
```

单测：长度 6、字符集、非空。

- [ ] **Step 2: Registry map**

```go
var Handlers = map[string]Handler{
  "ping":          handlePing,
  "sync.agents":   handleSyncAgents,
  "sync.tasks":    handleSyncTasks,
  "sync.messages": handleSyncMessages,
}
// agent.ask / agent.stop 不注册 → rejected
```

handlers 调现有 Store / 内部 service 读 agents、tasks、messages，再 `POST snapshot/*`。

- [ ] **Step 3: Bridge loop**

- 若启用且配置了 BaseURL + password：register（或启动时 register）→ 循环 heartbeat（5–10s）+ long-poll + 并行定时推 agents/tasks snapshot（15–30s）
- 收到 command → 查 Handlers；无则 result `rejected`；有则执行并 `done`/`error`

- [ ] **Step 4: 管理 API**

- `GET/PUT /api/admin/remote-relay/config` — base_url、enabled、instance_id、display_name（密码只写不回传明文）
- `POST /api/admin/remote-relay/password/rotate` — 生成新 6 位，返回明文一次，并触发 re-register
- `GET /api/admin/remote-relay/status` — last_ok、last_error

配置落盘：Atolla 数据目录或 DB 表（优先现有 store 模式；可新表 `remote_relay_config`）。

- [ ] **Step 5: `go test ./internal/remotebridge/...` + Commit**

```bash
git commit -m "feat(remotebridge): Mac outbound bridge and action registry"
```

---

### Task 8: 管理台「远程中继」菜单 + 一键部署脚本

**Files:**
- Modify: `web/src/App.jsx`（菜单项）
- Modify: `web/src/adminMenuIcons.jsx`
- Create: `web/src/RemoteRelayPanel.jsx`
- Create: `remote-relay/deploy/install.sh`
- Create: `remote-relay/deploy/atolla-remote-relay.service`
- Modify: `web/src/changelog.js`（新版本条目）

- [ ] **Step 1: 面板 UI** — Base URL、启用开关、显示名、生成/轮换密码（展示一次）、状态、注册按钮

- [ ] **Step 2: 部署表单** — host、ssh user/port、remote dir、listen port、site password；调用本机 API 触发脚本（或文档说明手动跑 `deploy/install.sh`；若 V1 仅脚本+复制命令也需在面板展示完整命令）

推荐 V1：面板生成可复制的：

```bash
./remote-relay/deploy/install.sh --host 1.2.3.4 --user root --port 3080 --site-password '...'
```

脚本内：rsync → 远端 npm ci/build → 写 systemd → health curl。

- [ ] **Step 3: changelog + 手动点验清单**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(admin): remote relay menu and deploy script"
```

---

### Task 9: 端到端验收（对照 spec §13）

- [ ] 本机起 `remote-relay`（HTTP 无证书）+ 门禁登录手机页
- [ ] Atolla 启用 Bridge，注册实例；列表可见；吊销后心跳 401
- [ ] 推送后可见数字人与任务；打开聊天后出现历史
- [ ] 确认无服务器→Mac 入站连接（仅 Mac 出站）
- [ ] `go test` 相关包 + `remote-relay` vitest + web build 通过

- [ ] **Final commit**（若有修复）

```bash
git commit -m "test(remote-relay): e2e acceptance fixes"
```

---

## Spec coverage check

| Spec 要求 | Task |
|---|---|
| Hybrid 同步 / 长轮询 | 4, 5, 7 |
| 单站门禁 + 防爆破 | 2 |
| Mac 6 位密码 7 天可吊销 | 3, 7, 8 |
| 不强制 HTTPS | 1, 9 |
| Nacos 实例 + mailbox | 3, 4 |
| V1 只读五页 | 6 |
| ActionRegistry | 4, 7 |
| 一键部署 / 管理台 | 8 |
| 验收标准 | 9 |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-13-remote-relay.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每 Task 派生子代理，Task 间审查  
2. **Inline Execution** — 本会话按 executing-plans 批量推进并设检查点  

**Which approach?**（确认后再写业务代码；本计划文档本身不启动实现。）
