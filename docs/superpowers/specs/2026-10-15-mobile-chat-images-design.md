# 移动端聊天图片（压缩 / OSS / 7 天清理）

日期：2026-10-15  
状态：已确认（用户批准开工）  
方案：**A — 复用 PC 图床 + 中继 RPC**

## 决策

| 项 | 选择 |
|----|------|
| 上传时机 | 点发送时再上传（未发送只删本地预览） |
| 清理 | OSS `chat/` 前缀生命周期 7 天 + Mac 定时清本地 |
| 上限 | 单次最多 6 张（对齐 PC） |
| 发布 | 先升云端移动端，再重启本机 Atolla |

## 架构

1. 手机压缩 JPEG → `POST .../chat-images`（enqueueAndWait `chat.image.upload`，base64）→ Mac `SaveChatImage`
2. `agent.ask` payload 增加 `attachments`；`AskManagedBackground` → `AskManagedWith`
3. 历史气泡读 mirror `payload.attachments` 展示；可点开大图
4. 启动时尝试配置 OSS lifecycle；每日扫本地 `.atolla/chat-images` 删 >7 天文件

## 非目标

- 未发送前服务端删除
- 手机直传 OSS / STS
- 改 PC 管理台 UI（已有）
