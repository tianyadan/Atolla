# Agent Local Image Display Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Codex/Cursor 回合结束后把本机图片路径上传为 chat attachments，PC/手机对话可展示。

**Architecture:** 回合结束扫描正文路径 → 白名单校验 → SaveChatImage → assistant meta.attachments → SSE `assistant_attachments`；手机复用消息镜像 attachments。

**Tech Stack:** Go service/store, existing chat images + OSS, React PC/mobile ChatMessageImages

## Global Constraints

- Engines: only `codex` / `cursor` (skip `claude`)
- Max 6 images/turn; OSS chat/ 7-day lifecycle (existing)
- Home dir + agent workspace allow; deny .ssh/.gnupg/Keychains etc.
- End-of-turn only (no mid-stream)

---

### Task 1: Path extract + allowlist + SaveChatImage batch (Go)

- [x] `agent_local_images.go` + tests
- [x] `UpdateMessageMeta` / merge attachments on message
- [x] Hook `finishManagedAsk` for codex/cursor

### Task 2: SSE + PC UI

- [x] Emit `assistant_attachments` after done
- [x] ManagedAgents applyEvents + show on assistant bubble

### Task 3: Mobile / mirror

- [x] Ensure mirror payload carries attachments for assistant
- [x] ChatHistory render assistant attachments like user
