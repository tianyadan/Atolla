# 数字员工审计看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将侧栏「统计」改为「审计」，为数字员工 Ask（后台 + 手机）落库并展示 ECharts 概览看板。

**Architecture:** 新建 `agent_ask_logs` / `agent_ask_tool_calls`；在 `askManagedCore` 挂钩写入（与 visitor 审计平行）；管理端聚合 API；替换旧统计页。

**Tech Stack:** Go + Gin + MySQL；React (web) + echarts

## Global Constraints

- 不改「对话审计」/ `visitor_ask_logs`
- 不计入项目协作 `AskManagedIsolated` / silentAsk
- 不回填历史；`processing` 不计入总次数
- 顶栏失败 = `failed + timeout`
- 菜单 id = `audit-agents`

---

### Task 1: Store 表与 CRUD/聚合

**Files:**
- Create: `server/internal/store/agent_ask_logs.go`
- Create: `server/internal/store/agent_ask_logs_test.go`
- Modify: `server/internal/store/store.go`（Migrate 调用 ensure）

- [x] Begin/Finish/InsertToolCall + overview/daily/weekly/tools/errors 聚合
- [x] 单测（可用 sqlite 则用；否则表结构 + 过滤逻辑的纯函数测 / 集成测跳过无 DB）

### Task 2: Ask 链路写入

**Files:**
- Modify: `server/internal/service/managed_agents.go`

- [x] `askCoreOpts.agentAudit`；AskManagedWith=admin；AskManagedBackground=mobile
- [x] usage/command/activity 事件写入；finalize 映射五态

### Task 3: Admin API

**Files:**
- Create: `server/internal/handler/agent_audit.go`
- Modify: `server/internal/handler/handler.go` 注册路由

### Task 4: 前端看板

**Files:**
- Create: `web/src/AgentAudit.jsx` (+ css 可内嵌 App.css)
- Modify: `web/package.json` 加 echarts
- Modify: `web/src/App.jsx`、`web/src/adminMenuIcons.jsx`

### Task 5: 验证

- [x] `go test` 相关包
- [x] 前端依赖安装；输出 conventional commit 说明（不自动 push，除非用户已要求）
