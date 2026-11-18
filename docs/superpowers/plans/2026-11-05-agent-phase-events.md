# Agent Phase Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Cursor、Codex、Claude 的真实运行事件统一转换为 `agent_phase` 并驱动当前对话水母动画。

**Architecture:** 每个 CLI Adapter 只理解自身协议并发出统一 `PhaseEvent`。Service 负责 SSE 转发，React 会话态负责保存和展示，不从文本或工具摘要反推阶段。

**Tech Stack:** Go、JSONL/SSE、React、Node test runner

**Spec:** `docs/superpowers/specs/2026-11-05-agent-phase-events-design.md`

## Global Constraints

- 不修改 CLI 源码，不伪造事件。
- 完成类事件不推断下一阶段。
- 保持现有工具、文本、Usage 和业务状态行为。

## Review Focus

- Cursor `thinking.completed` 与 `tool_call.completed` 不应错误切换阶段。
- Codex 工具完成后应等待下一条 reasoning/message 事件。
- Claude partial message 的 thinking/text/tool_use 必须区分。
- 未识别事件不得清空当前阶段。
- 回合结束和失败必须清理运行态阶段。

---

### Task 1: 统一阶段模型与 Cursor 适配

**Files:**
- Create: `server/internal/agent/phase.go`
- Modify: `server/internal/agent/generic.go`
- Test: `server/internal/agent/phase_test.go`

- [x] 先写 Cursor 事件映射失败测试并执行。
- [x] 实现 `AgentPhase`、`PhaseEvent`、`PhaseFn` 和 Cursor 映射。
- [x] 接入 Cursor stream-json 并执行 Agent 包测试。

### Task 2: Codex 与 Claude 适配

**Files:**
- Modify: `server/internal/agent/codex.go`
- Modify: `server/internal/agent/agent.go`
- Test: `server/internal/agent/phase_test.go`

- [x] 先写 Codex、Claude 映射失败测试并执行。
- [x] 将两类原生事件转换为统一阶段。
- [x] 执行 Agent 包测试。

### Task 3: SSE 与前端动画

**Files:**
- Modify: `server/internal/service/invoke.go`
- Modify: `web/src/managedAgentSessions.js`
- Modify: `web/src/jellyColor.js`
- Modify: `web/src/ManagedAgents.jsx`
- Test: `web/src/jellyColor.test.js`

- [x] 先写阶段到水母状态的失败测试并执行。
- [x] 转发 `agent_phase`，保存会话阶段并驱动当前对话头像和 RunStatus。
- [x] 执行 Go 测试、前端测试、lint 与 build。
