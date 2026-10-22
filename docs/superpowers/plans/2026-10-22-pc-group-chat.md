# PC 群聊（Grok 式共享时间线）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 管理台增加可选「生成群聊」岔路：共享时间线 + 群主主持串行开会；超时仍走现有 `@` 并行委托。

**Architecture:** 建 `group_chats` / `group_chat_members`；群消息复用 `messages`（挂 `shared_conversation_id`，`meta_json` 标发言人）。成员被点名时类似 `AskManagedIsolated`，但展示写群会话、resume 用该员工**主会话** `engine_session_id`，system 注入群规则 + 共享背景 +（群内标签 | 原 prompt/skills）。**禁止**首轮调用 `invokeAllParallel`。

**Tech Stack:** Go store/service/handler、React `web/src`（ManagedAgents + App 导航）、现有 JellyAvatar / Permission Gateway / SSE ask。

**Spec（定版）:** [docs/superpowers/specs/2026-10-22-pc-group-chat-design.md](../specs/2026-10-22-pc-group-chat-design.md)

## Global Constraints

- **双路径定死**：超时/未点 → 旧并行；点「生成群聊」→ 共享时间线开会（对齐 Grok Bot in X Chat）
- 成员总数 **3～5**（含群主=当前窗口员工）；不在区间不弹面板
- 共享背景：**仅群主**主会话截 ≤**10000** 字；其它成员不各带 10k
- 发言 resume：**各自主会话** engine session；气泡落在**群** conversation
- 有 `group_tag` → 忽略原系统提示词+技能
- MVP **仅 PC**；不做移动端 / remote-relay 群镜像
- 命令审批走现有 Permission Gateway
- Commits only if user asks

## File map

| 区域 | 路径 |
|--|--|
| Schema / CRUD | `server/internal/store/`（EnsureSchema + `group_chat*.go`） |
| 业务 | `server/internal/service/group_chat.go`（建群、背景截取、主持流水线、ask） |
| HTTP | `server/internal/handler/group_chat.go` + `handler.go` 路由注册 |
| 提及复用 | `server/internal/service/mention.go`（成员集合算法可抽 helper） |
| 引擎发言 | 复用 `AskManagedIsolated` 模式 / `runManagedEngine`；写群 conv |
| 5s 面板 | `web/src/ManagedAgents.jsx`（或拆 `GroupChatOfferSheet.jsx`） |
| 群聊 UI | `web/src/GroupChats.jsx`（列表+详情时间线） |
| 导航 | `web/src/App.jsx`（`digital.children` 增「群聊」） |
| 样式 | `web/src/App.css` / 现有 ma-* 水母类 |

---

## P0 — 表结构 + 建群 API + 5s 面板 + 群聊菜单（空时间线）

### Task 1: Store schema + group CRUD

**Files:**
- Modify: `server/internal/store/` EnsureSchema（或等价迁移入口）
- Create: `server/internal/store/group_chat.go`
- Create: `server/internal/store/group_chat_test.go`

**Schema:**

```text
group_chats(
  id, name, owner_agent_id, shared_background TEXT,
  shared_conversation_id, created_from_agent_id,
  seed_question TEXT, status ENUM-like active|archived,
  created_at, updated_at
)
group_chat_members(
  group_id, agent_id, role owner|member,
  group_tag TEXT NULL, joined_at,
  UNIQUE(group_id, agent_id)
)
```

- [ ] 写失败测：CreateGroup / ListGroups / GetGroupWithMembers / UpdateOwner / SetMemberTag
- [ ] 实现 CRUD；建群时 `CreateConversation`（或专用 type）得到 `shared_conversation_id`
- [ ] `go test ./internal/store/ -count=1` 通过

### Task 2: 建群服务 — 成员校验 + 群主背景 ≤10k

**Files:**
- Create: `server/internal/service/group_chat.go`
- Create: `server/internal/service/group_chat_test.go`
- Reuse: 主会话 RecentTurns / 消息拼接截断逻辑

**Produces:**
- `CreateGroupChat(ctx, fromAgentID, memberAgentIDs, seedQuestion) (*GroupChat, error)`
- 成员 = `unique(fromAgentID ∪ memberAgentIDs)`；长度须 ∈[3,5]
- `shared_background` = 群主主会话文本截断 ≤10000 字
- 群名：`协作 · {seed≤20字}` 或 `{群主名}的会议 · MMdd-HHmm`
- 写入 seed 用户消息到共享 conversation（`role=user`）

- [ ] 单测：人数 2 / 6 拒绝；3 人成功；背景长度上限
- [ ] `go test ./internal/service/ -run GroupChat -count=1` 通过

### Task 3: Admin HTTP API（建群 / 列表 / 详情）

**Files:**
- Create: `server/internal/handler/group_chat.go`
- Modify: `server/internal/handler/handler.go`（adm 路由）

**Routes:**
- `POST /api/admin/group-chats` body: `{ from_agent_id, member_ids[], seed_question }`
- `GET /api/admin/group-chats`
- `GET /api/admin/group-chats/:id`（成员含 jelly_color/name + 最近消息）

- [ ] 手动或 handler 测：鉴权 + 建群返回 id
- [ ] 重启后 curl 冒烟（本地）

### Task 4: PC 导航「群聊」+ 列表空态 / 详情空时间线

**Files:**
- Modify: `web/src/App.jsx` — `digital.children` 增加 `{ id: 'group-chats', label: '群聊' }`
- Create: `web/src/GroupChats.jsx`
- Modify: `web/src/App.jsx` 渲染分支挂载 GroupChats
- 复用: `JellyAvatar` / `jelly_color`

- [x] 列表：群名、人数、成员水母叠放预览
- [x] 详情：成员条 + 空/已有时间线（先只读 seed 用户消息）；用户气泡样式沿用「你」
- [x] 前端 build 通过

### Task 5: ManagedAgents 5s「生成群聊」面板

**Files:**
- Modify: `web/src/ManagedAgents.jsx`（`sendQuestion` 前）
- Optional Create: `web/src/GroupChatOfferSheet.jsx`
- 前端提及解析：对齐 `ParseMentions` / 现有 `@` token（`@[Name](#agent:ID)`）

**行为:**
- 发送前算 `unique(当前 agent ∪ @)`；仅当人数 ∈[3,5] 弹底部 Sheet（文案 + 水平进度条 5s +「生成群聊」）
- 超时/关闭 → 走现有 ask SSE（并行 invoke）
- 点生成 → `POST /api/admin/group-chats` → `setAdminMenu('group-chats')` + focus 新群；**不**发本轮 ask

- [x] 2 人 @：不弹面板，行为与现网一致
- [x] 3～5 人：弹面板；超时仍并行；点生成进群聊页且个人对话无本轮并行产物

---

## P1 — 首轮主持串行开会 + SSE + 气泡发言人

### Task 6: 群内发言原语（写群 conv + resume 主会话）

**Files:**
- Modify: `server/internal/service/group_chat.go`
- 参考: `AskManagedIsolated`、`runManagedEngine`、`BuildAgentSystemPromptWithSkills`

**Produces:** `SpeakInGroup(ctx, groupID, speakerAgentID, prompt, onEvent)`  
- InsertMessage 到 `shared_conversation_id`，`meta_json`: `{speaker_agent_id, speaker_name}`  
- system = 群规则 + shared_background + (group_tag **或** 原 prompt/skills) + 本轮主持指令  
- resume = speaker **主会话** engine_session_id（不是群 conv 的 session）  
- 权限/占用：与现网 ask 一致；命令仍走 Gateway  

- [x] 单测或集成：有 tag 时 system 不含原 skills 关键词夹具
- [x] SSE 事件至少：`speaker` / `chunk` / `done`（可复用 ask 事件形状并加 `speaker_*`）

### Task 7: 首轮主持流水线（建群后自动跑）

**Files:**
- Modify: `server/internal/service/group_chat.go`
- Modify: `POST /api/admin/group-chats` 或 `POST .../start-meeting`（二选一；推荐建群后可选 `?autostart=1`，前端点生成时带上）

**流水线（禁止 invokeAllParallel）:**

```text
seed 已在时间线
→ 群主 SpeakInGroup（拆任务 / 点名顺序）
→ 按点名串行 SpeakInGroup（每人一条）
→ 群主 SpeakInGroup（收尾）
```

- [x] 单测：mock Speak 调用顺序 owner → m1 → m2 → owner
- [x] 端到端：建群后时间线出现多条带不同 speaker 的 assistant 消息

### Task 8: 群详情 UI — SSE 开会 + 气泡小水母/小字名

**Files:**
- Modify: `web/src/GroupChats.jsx`
- CSS: 气泡旁 18～22px JellyAvatar + 小字 `speaker_name`

- [x] 建群后自动订阅开会 SSE；按 speaker 追加气泡
- [x] 成员发言可视化区分；系统条可无头像

---

## P2 — 群内续聊 / @ / 标签 / 转让群主

### Task 9: `POST /api/admin/group-chats/:id/ask`（用户续聊 + @）

**Files:**
- Modify: handler + `group_chat.go`
- Modify: `GroupChats.jsx` 输入框

- [x] 无 @：群主主持简短回应或按群主策略（MVP：群主直接 SpeakInGroup 答用户）
- [x] 有 @：仅被 @ 成员串行发言（仍写共享时间线）
- [x] 输入候选：群内成员小水母+名

### Task 10: 改 group_tag + 转让群主

**Files:**
- Routes: `PATCH .../members/:agentId` `{ group_tag }`；`POST .../transfer-owner` `{ new_owner_agent_id }`
- UI: 成员条点击编辑标签 / 转让

- [x] 有 tag 后再发言，行为符合 Task 6
- [x] 转让后后续主持角色切换；列表群主标识更新

### Task 11: 验收对照 spec §8 + 回归

- [ ] Spec 验收 1–7 手工过一遍  
- [ ] 现有单人 `@` 并行路径无回归（2 人、超时 5s）  
- [x] `go test ./internal/store/ ./internal/service/ ./internal/handler/ -count=1`  
- [x] `cd web && npm run build`  

---

## Spec coverage（自检）

| Spec 项 | Task |
|--|--|
| 双路径 / 5s 面板 | T5 |
| 3～5 人 / 群主 | T2 |
| 表结构 / 消息 meta | T1 |
| 背景 ≤10k | T2 |
| 建群 API / 菜单 / 水母列表 | T3–T4 |
| 串行开会 / 禁并行 | T6–T7 |
| 气泡发言人 | T8 |
| 续聊 @ / 标签 / 转让 | T9–T10 |
| 仅 PC | Global Constraints |

## Out of scope（本 plan 不做）

- remote-relay / 移动端群聊  
- Workflow 图打通  
- 群文件 / 语音 / 无限扩群  
