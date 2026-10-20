# 水母工作组实时事件流（SSE）

`GET /api/teams/:teamId/stream`

供水母 UI（`web/src/jelly/`）驱动触手动画。`teamId` 对应现有 **工作组** `agent_folders.id`；`0` 表示未入组员工（`folder_id` 为空）。

鉴权与其它管理端 API 相同：`Authorization: Bearer <JWT>`（挂在同一 JWT 路由组）。

## 协议要点

- `Content-Type: text/event-stream`
- 每条业务事件：`id: <seq>` + `data: <JSON>`，JSON 内含 `type`、`seq`（与 `id` 一致）
- 连接建立：无 `Last-Event-ID` 时先推 `snapshot`；有则尝试环形缓冲补发，缺口则重推 `snapshot`
- 心跳：每 15s 发送 SSE 注释行 `: ping <unix>`（不计 seq，防代理断开）
- 事件缓冲：进程内按工作组隔离的环形队列（默认 512），重启清空

## 事件一览

| type | 主要字段 | 来源挂钩 |
|------|----------|----------|
| `snapshot` | `teamId`, `agents[]`, `approvals[]` | 连接建立 / 补发缺口 |
| `agent.status` | `agentId`, `state`, `currentTask`, `name` | `setManagedAgentStatus`（Ask/停/压缩/复制/等待授权等） |
| `task.progress` | `taskId`, `agentId`, `progress`(0-100), `message` | `TaskProgress.report`；外部 `POST /api/agents/tasks` |
| `task.done` | `taskId`, `agentId`, `finishedAt` | `TaskProgress.done`；外部任务 status=done |
| `task.handoff` | `from`, `to`, `taskId` | 工作流 `runAgent`：直接上游 agent 节点 → 当前节点 |
| `approval.pending` | `approvalId`, `agentId`, `title`, `actions`（≤2） | `permission.Hub` 广播 `request` |
| `approval.resolved` | `approvalId`, `agentId?`, `action` | `permission.Hub` 广播 `resolved` |

### `state` 映射（对齐前端 `mapAgents.js`）

后端 `managed_agents.status` → 水母：

- `running` / `busy` / `compressing` / `initializing` → `working`
- `waiting` 或存在待审批 → `waiting`
- `error` → `error`
- 其它 / 空闲 → `idle`  
- 占用 `WORKFLOW` / `CLONE_INIT` 亦视为 `working`

### `agents[]`（snapshot）

```json
{
  "agentId": "7",
  "state": "working",
  "currentTask": "协作 · 写报告",
  "name": "前端"
}
```

### `approvals[]` / `approval.*`

```json
{
  "approvalId": "perm-…",
  "agentId": "5",
  "title": "导出任务的集成用例超时…",
  "actions": [
    { "k": "allow", "l": "本次允许", "pri": 1 },
    { "k": "deny", "l": "拒绝" }
  ]
}
```

`WorkspaceTrust` 时按钮文案为「信任并继续 / 拒绝」。

## 事件样例

```
id: 1
data: {"type":"snapshot","seq":1,"teamId":"1","agents":[{"agentId":"2","state":"working","currentTask":"画环礁视图 · 40%","name":"UI 设计师"}],"approvals":[]}

id: 2
data: {"type":"agent.status","seq":2,"agentId":"2","state":"working","currentTask":"画环礁视图","name":"UI 设计师"}

id: 3
data: {"type":"task.progress","seq":3,"taskId":"run-2-…","agentId":"2","progress":62,"message":"重构任务清理"}

id: 4
data: {"type":"approval.pending","seq":4,"approvalId":"abc","agentId":"5","title":"…","actions":[{"k":"allow","l":"本次允许","pri":1},{"k":"deny","l":"拒绝"}]}

id: 5
data: {"type":"approval.resolved","seq":5,"approvalId":"abc","agentId":"5","action":"allow"}

id: 6
data: {"type":"task.handoff","seq":6,"from":"2","to":"3","taskId":"wf-12-nodeB"}

id: 7
data: {"type":"task.done","seq":7,"taskId":"run-2-…","agentId":"2","finishedAt":"2026-10-20T09:00:00Z"}

: ping 1760950000
```

## curl 示例

```bash
# 登录拿 JWT 后：
TOKEN='…'

# 首次连接（先收 snapshot）
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  "http://127.0.0.1:8080/api/teams/1/stream"

# 断线重连补发（假设上次最后 seq=7）
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  -H "Last-Event-ID: 7" \
  "http://127.0.0.1:8080/api/teams/1/stream"
```

## 与前端对接说明

前端 `useTeamStream` / `teamStreamAdapter` 已按上述字段解析。注意：

1. `progress` 后端为 **0–100 整数**（前端亦兼容 0–1）。
2. `agentId` / `approvalId` / `from` / `to` 以 **字符串** 推送。
3. `task.handoff` 仅在 **项目协作（workflow）** 节点间、直接上游为 agent 且 `agent_id` 不同时推送；普通 Ask 无交接概念，不会推送。
4. 未入组请用 `teamId=0`（与水母页「未分组」一致）。
