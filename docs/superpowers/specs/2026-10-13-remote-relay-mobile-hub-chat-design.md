# remote-relay 移动端 Hub / 设置 / 对话（v0.0.2）

日期：2026-10-13  
状态：已确认（方案 1：命令扩展 + 镜像增强）  
版本：remote-relay **v0.0.2**

## 背景

v0.0.1 已具备站点门禁、实例 unlock、镜像只读同步。本版补齐移动端信息架构：设置与更新记录、实例功能宫格、按工作组分组的数字人列表、完整对话闭环（含任务规划开关与进度）。

## 已确认决策

| 项 | 选择 |
|----|------|
| 对话 | 完整闭环 `agent.ask`（文字；不经 SSE 回手机） |
| 分组 | 与管理台一致：工作组 folders +「未入组」 |
| 版本记录 | 仅 `remote-relay/CHANGELOG.md` |
| 导航 | 列表点卡片直达对话页 |
| 任务规划 | 手机可开关（`agent.set_task_plan`） |
| 状态展示 | 仅「空闲 / 忙碌中」两态（由平台 status 映射） |
| 不做 | 群聊、手机审批、@协作、发图、直连 Mac API |

## §1 信息架构与路由

```
/instances                         实例列表（右上角设置 SVG）
  └ /settings                      当前版本 +「更新记录」
       └ /settings/changelog       CHANGELOG 游标无限滚动（新→旧）
/instances/:id                     实例宫格 Hub（需 unlock）
  ├ 数字员工 → /instances/:id/agents
  │              └ .../agents/:agentId/chat
  └ 群聊 → 页内「正在开发」（不跳转）
```

- 进入实例先到 Hub，不再直达数字人列表。
- 设置挂在站点级（实例列表顶栏），不绑定单个 Mac。
- 旧 `AgentDetail`（任务列表中间页）下线或重定向到 chat。

## §2 设置页与 Changelog API

**UI**

- 实例列表顶栏：设置齿轮 SVG → `/settings`（保留退出）。
- 设置页：返回、当前版本 `vX.Y.Z`、菜单「更新记录」。
- Changelog 页：无限向下滚动；最新版本在顶；`cursor` 加载更多。

**API**（站点 JWT；无需 unlock）

- `GET /api/meta/version` → `{ version: "0.0.2" }`
- `GET /api/meta/changelog?cursor=&limit=10`
  - 启动时解析 `remote-relay/CHANGELOG.md`（`## vX.Y.Z — date` + `-` bullets）
  - 响应：`{ items: [{ version, date, items: string[] }], next_cursor, has_more }`
  - `cursor` = 上一页最后一条 `version`；空 = 从最新开始
  - 文件缺失 → 空列表 + 日志，不 500

**版本同步**

- `server/package.json` version、`CHANGELOG.md` 标题、`/api/meta/version` 三者一致为 **0.0.2 / v0.0.2**。

## §3 实例 Hub + 数字人列表

**Hub**（需 unlock）

- 顶栏：返回实例列表 + 实例显示名。
- 一排 4 格 SVG：① 数字员工 ② 群聊（正在开发）③④ 灰态占位不可点。

**数字人列表**

- 按 `folder_id` 分组；`0` →「未入组」；组标题用 `folder_name`。
- 卡片：头像、名称、状态两态。
- 状态映射：`running` / `busy` / `插话中` / `initializing` / `compressing` / `waiting` → **忙碌中**；其余 → **空闲**。
- 点击 → 对话页。

**Mac `sync.agents` 增强字段**

- 顶层或 payload：`avatar_url`、`folder_id`、`folder_name`、`task_plan_enabled`（`status` 已有）。
- 头像空或加载失败 → 默认头像（与 PC `DEFAULT_AGENT_AVATAR` 同策略）。

## §4 对话页 + 命令闭环

**UI**

- 顶栏：返回、头像、名称、空闲/忙碌。
- `task_plan_enabled` 为真时：水平进度条（当前任务 progress）；点击 → Modal（任务名、百分比、步骤列表，对齐 PC）。
- 消息区：你 / 助手气泡；镜像带 attachments 则可展示缩略图（本版发送仍仅文字）。
- 底部：任务规划开关 + 输入 + 发送；忙碌时可插话；提供终止。

**Mac RemoteBridge 新动作**

| action | payload | 行为 |
|--------|---------|------|
| `agent.ask` | `{ agent_id, question }` | 调现有 Ask（异步跑完）；命令结果 `accepted` 或错误；**不向手机 SSE** |
| `agent.stop` | `{ agent_id }` | 终止该员工当前问答 |
| `agent.set_task_plan` | `{ agent_id, enabled }` | 写库 `task_plan_enabled` |

- Relay：将上述三者加入 `V1_EXECUTABLE`；移除「reserved 拒绝 enqueue」。
- 手机：optimistic 用户气泡 → enqueue ask → 轮询 sync.messages / 读镜像 + sync.agents / sync.tasks 刷新状态与进度。

**站点 API**（需 unlock）

- `POST /api/instances/:id/agents/:agentId/ask` `{ question }`
- `POST /api/instances/:id/agents/:agentId/stop`
- `POST /api/instances/:id/agents/:agentId/task-plan` `{ enabled }`
- 沿用现有 agents / tasks / messages / sync-messages

## §5 错误处理、测试、版本

**错误**

- 未 unlock / unlock 失效 → 403，回实例列表并清 unlock。
- ask 被拒或 Mac 离线 → 对话错误条；optimistic 气泡可标失败。
- Changelog 解析失败 → 空列表。

**测试**

- Relay：changelog 解析 + cursor；ask/stop/task-plan enqueue；agents 镜像字段；`agent.ask` 可入队。
- Go：ask / stop / set_task_plan handler 单测。
- Web：`npm run build`。

**版本**

- remote-relay **v0.0.2** 记入 `CHANGELOG.md`。

## 非目标（本版）

- 群聊功能体
- 手机端权限审批 UI
- @ 协作、发送图片
- 手机直连 Mac `/admin` API
- 扩充第三种以上数字人状态文案
