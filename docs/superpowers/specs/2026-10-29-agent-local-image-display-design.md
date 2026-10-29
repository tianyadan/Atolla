# Codex / Cursor 本机选图展示设计

日期：2026-10-29  
状态：已确认（方案 A）  
范围：PC 管理台数字人对话 + Remote Relay Web/App；引擎仅 Codex / Cursor（不含 Claude）

## 背景

用户希望数字人（Codex / Cursor）在本机查找并「指出」图片后（例如桌面上约 10 点的截图），平台能在 PC 与手机对话中展示该图，而非仅显示路径文本。图片可上传 OSS，短暂保留约 7 天。

已有能力：

- 用户附图：`SaveChatImage` + `meta.attachments` + `ChatMessageImages` / Lightbox
- OSS `chat/` 前缀已配置约 7 天 lifecycle（`EnsureChatImageOSSLifecycle`）
- 工作区读图：`GET /admin/agents/:id/file`（防穿越，仅工作区）

缺口：引擎回复中的**本机绝对路径**不会自动入库为可展示附件；手机更无法直接读 Mac 本地文件。

## 目标

1. Codex / Cursor 回合结束后，从最终回复（及本轮命令摘要）识别合法本机图片路径。
2. 校验白名单 → 读盘 → 压缩 → 本地 `chat-images` + 可选 OSS → 写入该条 assistant 的 `meta.attachments`。
3. PC 实时看到附图；手机经既有消息镜像/轮询看到同一套 attachments。
4. Claude 引擎不启用此逻辑。

## 非目标

- Claude 生图 / 选图展示
- 回合过程中实时出图（不做流式插图）
- 非图片文件、目录打包
- 修改引擎 CLI 本身或强制专用「展示图」工具（本期不依赖）

## 已确认决策

| 项 | 选择 |
|----|------|
| 方案 | A：路径识别 + OSS/本地 chat-image + assistant meta |
| 引擎 | 仅 `codex` / `cursor` |
| 时机 | 回合结束统一处理 |
| 路径范围 | `$HOME` 下可读图片；排除敏感目录 |
| 存储 | 复用 `SaveChatImage` + 现有 `chat/` 7 天 OSS lifecycle |
| 展示 | 与用户附图同一 UI（缩略图 + Lightbox） |
| 单回合上限 | 6 张（与 `chatImageMaxCount` 对齐） |

## §1 路径提取

### 输入源（回合结束时）

1. 本轮最终 assistant 正文 `out`（完整流式汇总，优先于可能被切段的 `persist` 尾巴）
2. 本轮已落库的 `command` 消息摘要/content（可选：同一 `conversation_id` 且 `created_at` ≥ 本轮 Ask 开始时间，或 Ask 期间缓冲的路径集合）

推荐实现：在 Ask 期间用内存 set 收集「疑似图片路径」（从 command 摘要与流式正文增量中轻量扫描），回合结束与 `out` 合并去重。避免只扫 `persist` 尾巴漏掉前文路径。

### 匹配规则

- POSIX / macOS 绝对路径，扩展名大小写不敏感：`.png` `.jpg` `.jpeg` `.webp` `.gif` `.heic` `.heif`
- 支持反引号、引号、Markdown 链接 `` [`x`](/path) ``、`file:///...`（规范化后）
- 相对路径：仅当相对**数字人工作区 root** 可解析为存在文件时采纳；否则忽略
- 去重：`EvalSymlinks` 后的绝对路径唯一

### 误匹配防护

- 路径段必须真实存在且为普通文件（`Stat` → 非目录）
- 体积上限与用户上传一致（原始 ≤ 8MB；过大跳过并打日志）
- 忽略明显非路径 token（过短、含控制字符）

## §2 白名单与拒绝

**允许（须同时满足）**

- 解析后路径落在：
  - `os.UserHomeDir()` 之下，或
  - 该数字人工作区目录之下（`EvalSymlinks` 后前缀匹配）
- Mime/扩展名为图片

**拒绝（前缀或路径段命中即跳过）**

示例（实现时集中常量维护，可增减）：

- `~/.ssh`、`~/.gnupg`、`~/.aws`、`~/.config/gcloud`
- `~/Library/Keychains`、`~/Library/Keys`
- 任意路径段名为 `.ssh` / `.gnupg` / `Keychains`

**引擎门控**

```text
engine ∈ {codex, cursor} 才执行提取与上传
claude → 直接跳过
```

## §3 上传与落库

1. `os.ReadFile` → `SaveChatImage(ctx, raw, baseName)`（现有压缩为 JPEG；HEIC 若解码失败则跳过该张）
2. 得到 `ChatAttachment{id,url,mime,name}`
3. 写入 assistant 消息：
   - 若本回合已 `InsertMessage` 得到 `msg.ID`：`UpdateMessageMeta` 合并 `attachments` 数组
   - 若因空尾巴未插入 assistant 行但有附图：插入一条仅附图（或附图 + 简短说明）的 assistant，避免「有图无气泡」
4. `meta_json` 形状与用户附图一致：

```json
{
  "attachments": [
    { "id": "...", "url": "https://.../chat-....jpg", "mime": "image/jpeg", "name": "Screenshot.png" }
  ]
}
```

OSS 未配置时：`url` 仍可为 `/api/chat-images/{id}.jpg`；手机中继需能代理或改为可公网访问的 URL（与现网用户附图行为一致：优先 OSS）。

## §4 实时推送（PC）与手机

### PC SSE

在现有 `done` 事件之后（或扩展 `done` 字段）增加：

```json
{ "type": "assistant_attachments", "attachments": [ /* 同上 */ ], "message_id": 123 }
```

前端 `ManagedAgents.applyEvents`：找到对应/最后一条 assistant，写入 `attachments`，复用 `ChatMessageImages`。

历史拉取：`mapMsgs` 已读 `meta.attachments`，无需新字段。

### 手机 / App

- Mac 侧落库后走既有 `PushAgentMessagesSnapshot`（终态已有）
- 中继镜像消息 `payload` 需带上 `attachments`（与用户附图同步路径对齐；若镜像层目前丢 meta，补传）
- `ChatHistory` 对 assistant 气泡与 user 一样渲染 `attachmentsFromPayload`

## §5 安全

- 不把原始本机绝对路径写入 OSS 对象名；仅 `chat-{id}-{ts}.jpg`
- 日志可记 basename + 是否成功，避免完整敏感路径刷屏
- 单回合最多 6 张；失败单张跳过，不影响正文落库
- 不提升沙箱权限：引擎本就能读的文件，平台只负责「展示通道」

## §6 测试要点

- 单元：路径正则 / `file://` / 工作区相对路径 / 敏感目录拒绝 / 去重
- 单元：仅 codex/cursor 触发；claude 不触发
- 集成或手工：桌面截图路径在最终回复中 → PC 气泡出图 → 手机同步可见 → Lightbox
- OSS 关闭时本地 `/api/chat-images/` 仍可在 PC 展示

## §7 实现落点（预告）

| 区域 | 文件（预期） |
|------|----------------|
| 路径提取 + 白名单 | `server/internal/service/agent_local_images.go`（新） |
| 回合收尾挂钩 | `managed_agents.go` `finishManagedAsk` / ask 收尾 |
| Meta 更新 | `store` 增加或复用 message meta update |
| SSE | `handler/managed_agents.go` ask 流 |
| PC UI | `ManagedAgents.jsx` + 已有 `ChatMessageImages` |
| 手机 UI / 镜像 | `remote-relay` 消息 payload + `ChatHistory.tsx` |

## 验收

- [ ] Codex/Cursor：回复含桌面图片绝对路径时，PC 无需刷新即可看到缩略图并可放大
- [ ] 同一会话手机端可见对应图（OSS 或现网等价可达 URL）
- [ ] Claude 回合不扫描、不上传
- [ ] 敏感目录路径被跳过；超过 6 张截断
- [ ] 图片走 `chat/` 前缀，沿用约 7 天过期
