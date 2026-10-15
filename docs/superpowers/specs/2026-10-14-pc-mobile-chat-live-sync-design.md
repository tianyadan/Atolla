# PC / 手机会话实时同步 + 手机查看标识

日期：2026-10-14  
状态：已确认  
范围：管理台数字人对话 ↔ Remote Relay 移动端同会话近实时；PC 标识手机正在查看的数字人

## 背景

- 手机端已有 4s `sync.messages` + Mac `PushAgentMessagesSnapshot`，打开对话即可更新。
- PC 管理台仅在本机 SSE ask / 切人时加载消息；轮询只刷 status/tasks。
- 需要：同看一个数字人时双方消息近实时；PC 列表与对话顶栏用手机图标标出「手机正在看谁」。

## 已确认决策

| 项 | 选择 |
|----|------|
| 同步方式 | 轻量 presence 命令 + PC 消息轮询（不新开 WebSocket） |
| 手机图标 | 选项 A：标「手机端当前正在查看」的数字人（非 PC 选中态） |
| presence TTL | Mac 内存；约 60s 无心跳视为离开 |
| PC 轮询 | 选中且非本机 SSE loading 时 `loadDetail(force)`；忙或 mobile_viewing 时约 2s，否则约 4s |

## §1 Presence

| action | payload | 行为 |
|--------|---------|------|
| `viewer.set` | `{ agent_id }` | Mac 记录 mobileViewerAgentID + updatedAt |
| `viewer.clear` | `{}` 或 `{ agent_id }` | 清空查看态 |

- 手机进入对话：`viewer.set`；每 ~25s 心跳；离开/卸载：`viewer.clear`
- `GET /admin/agents` 对应该 agent 返回 `mobile_viewing: true`

## §2 消息同步

- **手机 → PC**：PC 在对话页轮询 messages（force coalesce），不打断本机 SSE 流式。
- **PC → 手机**：`AskManaged` / SSE ask 结束后 `PushAgentMessagesSnapshot`；手机既有 poll 仍保留。

## §3 PC UI

- 15×15 线性手机 SVG；侧栏名称旁 + 对话顶栏；仅 `mobile_viewing` 时显示。

## §4 不做

- WebSocket / 跨 tab BroadcastChannel
- 手机端显示「PC 正在查看」
- 非对话页的全局消息推送
