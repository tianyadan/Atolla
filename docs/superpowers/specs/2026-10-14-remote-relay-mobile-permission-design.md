# remote-relay 移动端命令审批（v0.0.3）

日期：2026-10-14  
状态：已确认（方案 1：命令扩展 + 权限镜像推送）  
版本：remote-relay **v0.0.3**

## 背景

v0.0.2 对话闭环已可用，但设计明确排除「手机端权限审批」。PC 管理台已有：

- 人工授权弹窗（同意 / 拒绝 / 本次会话允许）
- 「命令全部审批通过」(`auto_approve_all`)
- 「自动审核」(`auto_review`)

手机发问后若触发 REVIEW，数字人会卡在等待授权，而用户在手机上看不到弹窗。本版在不直连 Mac API 的前提下，把审批与策略开关同步到移动端。

## 已确认决策

| 项 | 选择 |
|----|------|
| 实现路径 | 方案 1：命令扩展 + 权限镜像推送 |
| 范围 | 审批弹窗 + 两个策略开关一次做完 |
| 策略语义 | 与 PC 一致：全部通过开启时自动审核禁用；Hard Deny 不可绕过 |
| 待授权发现 | Mac 推送 pending 镜像；手机轮询读取（不长等 command result） |
| 裁决 | `permission.decide` 入队，Mac Hub.Decide |
| 不做 | 群聊、@、发图、直连 Mac `/permissions/*`、Bark 到手机推送 |

## §1 策略开关（对齐 PC）

### UI

- 对话页顶栏或底栏入口：「命令审批设置」（有任一策略开启时显示状态点，对齐 PC）。
- Modal（复用现有 `Modal`）：
  - **命令全部审批通过**：hint「开启后无需人工审批，全部自动通过；自动通过记录写入数据库，最多保留 7 天」
  - **自动审核**：hint「开启后由 AI 审核非常规命令（仍可能弹窗）」；当「全部通过」开启时控件 disabled
- 开关成功后乐观更新本地 agent payload，并刷新 agents 镜像。

### Mac / Relay

| action | payload | 行为 |
|--------|---------|------|
| `agent.set_auto_approve_all` | `{ agent_id, enabled }` | `Store.SetManagedAgentAutoApproveAll`；回推 agents 快照 |
| `agent.set_auto_review` | `{ agent_id, enabled }` | `Store.SetManagedAgentAutoReview`；若 `conversation_id>0` 则 `Perms.SetAuto(conv, enabled)`；回推 agents 快照 |

- `sync.agents` / 周期推送的 agent `payload` 增加：`auto_review`、`auto_approve_all`（boolean）。
- Relay：二者加入 `V1_EXECUTABLE` + 实例 actions 声明。
- 站点 API（需 unlock）：
  - `POST /api/instances/:id/agents/:agentId/auto-approve-all` `{ enabled }`
  - `POST /api/instances/:id/agents/:agentId/auto-review` `{ enabled }`

### AgentRuntime / ExecContext

扩展 bridge 可访问权限中枢（避免 service 循环依赖），例如：

- `AgentRuntime` 增加 `SetAutoReview(agentID, enabled)` / `SetAutoApproveAll` 封装，或
- `ExecContext` 注入 `Perms` 接口：`SetAuto(convID, enabled)` + `Decide(...)` + `Pending(convID)`

以能完成 handler 为准；优先薄接口。

## §2 人工审批弹窗

### 推送与镜像

Relay 新表 `permissions_mirror`（或等价命名）：

| 列 | 说明 |
|----|------|
| `instance_id` + `request_id` | 主键 |
| `agent_id` | 由 `ConversationAgentID(conv)` 解析；解析失败则本条不入库（或记 `agent_id=''` 且站点不展示） |
| `conversation_id` | 数字 |
| `tool_name`, `summary`, `note`, `meaning`, `risk` | 与 Hub `Public` 对齐 |
| `created_at`, `deadline` | ISO 或毫秒；用于倒计时 |
| `synced_at` | 推送时间 |

Device API（实例口令）：

- `POST /api/device/permissions/snapshot`：upsert 一批 pending（可按 agent 或全量）
- `POST /api/device/permissions/resolved`：`{ request_ids: string[] }` 删除已裁决

Mac bridge：

- 连接成功后：`Pending(0)` → 映射 agent → 推 snapshot
- 订阅 Hub：`Event.Kind=="request"` → **不要只信 Event.Req**（Register 广播时 meaning/risk 往往尚未写入）；用 `Hub.Pending(conv)` 或按 `request_id` 再取最新 `Public` 后 upsert；`resolved` → 按 `request_id` 删除
- 连接成功后立即全量 `Pending(0)` 推送一次；可选每 N 次心跳全量推送防漏

站点 API（需 unlock）：

- `GET /api/instances/:id/agents/:agentId/permissions/pending` → `{ items: [...] }`（仅该 agent、未过 deadline 的行；过期可由读时过滤或 Mac 推删除）

### UI

- 对话页打开时与消息轮询同频（约 4s）拉 pending；有条目则展示授权 Modal/浮层（对齐 PC `PermCard`）：
  - 标题：申请授权 + 剩余秒数（deadline）
  - 工具名、命令块（复用 `CmdBlock` 风险色）、含义/备注
  - 多条：`+N 条排队中`；一次只裁决队头
  - 按钮：拒绝 / 本次允许 / 本次会话允许
- 点击后：`POST .../permissions/decide` `{ request_id, behavior }` → enqueue `permission.decide`；本地立即出队该 `request_id`（乐观）；失败则提示并下次轮询恢复。
- 超时：deadline 已过则本地隐藏；Mac Hub 超时拒绝后会推 resolved。

### Mac decide

| action | payload | 行为 |
|--------|---------|------|
| `permission.decide` | `{ request_id, behavior: allow\|deny\|allow_session }` | `Hub.Decide`（`allow_session` → session=true）；成功后推 resolved（若订阅已覆盖可省略二次推送） |

## §3 错误处理、测试、版本

### 错误

- 未 unlock → 403，回实例列表。
- Mac 离线：开关/裁决 enqueue 失败 → 错误条；pending 列表可能为空或陈旧（展示「无法同步授权」仅在连续失败时）。
- `request_id` 已裁决 → Mac 返回 unknown；手机出队即可。
- Hard Deny 不出现在 pending（Gateway 已拦）。

### 测试

- Relay：permissions mirror upsert/delete；site GET pending；enqueue `permission.decide` / `agent.set_auto_*`；agents payload 字段。
- Go：set_auto_* handlers；decide handler；agents snapshot 含新字段；可选 bridge 订阅推送单测（mock client）。
- Web：`npm run build`；对话页设置 Modal + 授权卡交互可手测。

### 版本

- remote-relay **v0.0.3**：`server/package.json`、`CHANGELOG.md`、`/api/meta/version` 三者一致。
- CHANGELOG 记录：手机命令审批弹窗、全部审批通过/自动审核同步。

## 非目标（本版）

- 群聊、@、发图
- 手机直连 Mac HTTP
- 工作流节点权限聚合（仅 managed agent 对话）
- 全局跨实例授权浮层（仅当前对话页）
- 修改 PC 管理台审批语义

## 与 v0.0.2 关系

v0.0.2 非目标「手机端权限审批 UI」由本版撤销并实现；其余非目标保持不变。
