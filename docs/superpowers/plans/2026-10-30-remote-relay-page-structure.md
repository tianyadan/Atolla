# Remote Relay Page Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆分远程中继页面配置模块、调整顺序，并让部署日志按需显示且跨菜单短时保留。

**Architecture:** 保持 `RemoteRelayPanel` 常驻挂载，部署 SSE 和日志状态不随菜单切换销毁；纯函数负责日志可见性与终态过期时间。现有后端协议不变。

**Tech Stack:** React 19、JavaScript ES Modules、Node.js test runner

**Spec:** `docs/superpowers/specs/2026-10-30-remote-relay-page-structure-design.md`

## Global Constraints

- 不新增部署日志持久化。
- 运行中的日志不可自动过期。
- 终态日志保留 10 分钟。
- SMTP 与远程连接使用现有接口，不修改后端。

## Review Focus

- 页面切走后部署流仍继续，返回时日志与状态保持。
- 未触发部署或升级时不展示空日志框。
- 新任务开始时取消上一任务的清理定时器。
- 成功和失败都在 10 分钟后清除日志。
- 页面彻底卸载时取消 SSE 与定时器。

### Task 1: 部署日志状态策略

**Files:**
- Create: `web/src/remoteRelayPanelModel.js`
- Create: `web/src/remoteRelayPanelModel.test.js`

- [ ] 先写可见性、终态过期和运行中不过期测试并验证失败。
- [ ] 实现 `shouldShowDeployProgress` 与 `deployLogExpiresAt`。
- [ ] 运行定向测试验证通过。

### Task 2: 页面布局与短时日志

**Files:**
- Modify: `web/src/RemoteRelayPanel.jsx`
- Modify: `web/src/App.jsx`

- [ ] 将服务器部署移到页面头部，连接和 SMTP 拆成独立卡片。
- [ ] 仅在有任务状态或日志时展示部署进度。
- [ ] 组件保持挂载；终态后 10 分钟清理，新任务取消旧定时器。
- [ ] 卸载时终止 SSE 和定时器。

### Task 3: 验收

- [ ] 运行 `node --test src/*.test.js`。
- [ ] 运行 `npm run lint` 与 `npm run build`。
- [ ] 运行 `git diff --check` 并检查变更范围。
