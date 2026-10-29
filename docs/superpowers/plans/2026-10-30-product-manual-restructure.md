# Atolla Product Manual Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Atolla 产品手册扩展为九个核心模块的完整用户与实现指南，并彻底排除“项目协作流程图”废案。

**Architecture:** 保留 `ProductManual.jsx` 的静态 Markdown 渲染方式，将内容按一级模块拆到 `productManualContent` 目录，`productManual.js` 只做分类和文章汇总。每篇使用 Markdown `text` 流程图，不引入新渲染依赖。

**Tech Stack:** React 19、JavaScript ES Modules、marked、Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-10-30-product-manual-restructure-design.md`

## Global Constraints

- 只修改产品手册内容与相关测试，不删除 Workflow 产品代码。
- 手册不出现“项目协作”、Workflow Canvas 或对该废案的引导。
- 内容以当前代码和已发布功能为准，不把计划写成现状。
- 每篇至少有一个 fenced `text` 流程图与明确的边界说明。
- 保持 `PRODUCT_MANUAL_CATEGORIES` 和 `PRODUCT_MANUAL_ITEMS` 公开导出兼容现有页面。

## Review Focus

- 分类 `itemIds` 与文章 ID 不一致时，测试必须报出缺失或孤儿文章。
- 文章 ID 重复时，测试必须失败，避免菜单选中错误内容。
- 新文章缺少流程图或边界章节时，测试必须失败。
- 任何文章重新出现项目协作/Workflow 引导时，测试必须失败。
- 分拆内容文件后，`ProductManual.jsx` 必须仍能直接导入原有两个数组并完成构建。

---

### Task 1: 手册注册表与结构测试

**Files:**
- Modify: `web/src/productManual.js`
- Modify: `web/src/productManual.test.js`
- Create: `web/src/productManualContent/*.js`

**Interfaces:**
- Produces: `PRODUCT_MANUAL_CATEGORIES: Array<Category>`
- Produces: `PRODUCT_MANUAL_ITEMS: Array<ManualItem>`
- `Category = { id, label, description, itemIds }`
- `ManualItem = { id, categoryId, label, description, content }`

- [ ] **Step 1: 先扩展结构测试**

断言一级分类 ID 依次为 `platform`、`employees`、`conversation`、`safety`、`collaboration`、`memory`、`skills`、`remote`、`observability`；文章 ID 唯一，每个 `itemId` 可解析，无孤儿文章。

- [ ] **Step 2: 运行测试确认新结构尚未实现**

Run: `node --test src/productManual.test.js`
Expected: FAIL，分类数量或 ID 不匹配。

- [ ] **Step 3: 建立九个内容文件与汇总注册表**

内容文件分别导出 `platformItems`、`employeeItems`、`conversationItems`、`safetyItems`、`collaborationItems`、`memoryItems`、`skillItems`、`remoteItems`、`observabilityItems`；`productManual.js` 统一汇总。

- [ ] **Step 4: 运行结构测试**

Run: `node --test src/productManual.test.js`
Expected: PASS。

### Task 2: 平台、员工与对话内容

**Files:**
- Modify: `web/src/productManualContent/platform.js`
- Modify: `web/src/productManualContent/employees.js`
- Modify: `web/src/productManualContent/conversation.js`
- Test: `web/src/productManual.test.js`

**Interfaces:**
- Consumes: Task 1 的 `ManualItem` 结构。
- Produces: 平台启动/引擎、数字员工生命周期、对话/任务执行文章。

- [ ] **Step 1: 增加内容完整性测试**

断言每篇包含 `# ` 标题、`\`\`\`text` 流程图、“实现逻辑”和“边界说明”章节。

- [ ] **Step 2: 运行测试确认占位内容不合格**

Run: `node --test src/productManual.test.js`
Expected: FAIL，报告缺失的内容段。

- [ ] **Step 3: 完成三个模块正文**

依据当前 React 页面、Go handler/service/store 和引擎适配层编写操作流、调用链、状态和边界。

- [ ] **Step 4: 运行定向测试**

Run: `node --test src/productManual.test.js`
Expected: PASS。

### Task 3: 安全、协作与记忆内容

**Files:**
- Modify: `web/src/productManualContent/safety.js`
- Modify: `web/src/productManualContent/collaboration.js`
- Modify: `web/src/productManualContent/memory.js`
- Test: `web/src/productManual.test.js`

**Interfaces:**
- Consumes: Task 1 的 `ManualItem` 结构。
- Produces: Permission Gateway/JEV/审计、`@` 委托/群聊、Session/压缩/继承记忆文章。

- [ ] **Step 1: 增加废案词扫描测试**

汇总所有文章 `content` 并断言不包含“项目协作”、`Workflow Canvas`、“改用项目协作”。

- [ ] **Step 2: 运行测试确认旧引导被检出**

Run: `node --test src/productManual.test.js`
Expected: FAIL，命中现有“改用项目协作”文案。

- [ ] **Step 3: 迁移并扩展三个模块正文**

保留现有命令审核、记忆、对话引用中已验证的代码级事实，重写分类归属，不保留项目协作引导。

- [ ] **Step 4: 运行定向测试**

Run: `node --test src/productManual.test.js`
Expected: PASS。

### Task 4: 技能、远程与可观测性内容

**Files:**
- Modify: `web/src/productManualContent/skills.js`
- Modify: `web/src/productManualContent/remote.js`
- Modify: `web/src/productManualContent/observability.js`
- Test: `web/src/productManual.test.js`

**Interfaces:**
- Consumes: Task 1 的 `ManualItem` 结构。
- Produces: 技能/数据库/服务器/文件资源、中继/实例/多端、Bark/灵动岛/审计/健康状态文章。

- [ ] **Step 1: 完成三个模块正文**

依据当前技能配置、remote-relay 镜像/命令队列、Bark 和 iOS/macOS 灵动岛代码编写。

- [ ] **Step 2: 运行定向测试**

Run: `node --test src/productManual.test.js`
Expected: PASS。

### Task 5: 全量验收

**Files:**
- Verify: `web/src/productManual.js`
- Verify: `web/src/productManualContent/*.js`
- Verify: `web/src/ProductManual.jsx`
- Verify: `web/src/productManual.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 的完整手册注册表和内容。
- Produces: 可在现有产品手册页面中直接浏览的最终版。

- [ ] **Step 1: 运行手册与 PC 全量单测**

Run: `node --test src/*.test.js`
Expected: all tests pass。

- [ ] **Step 2: 运行 lint**

Run: `npm run lint`
Expected: exit 0；允许仓库已有 warning，不得新增 error。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`
Expected: Vite build succeeds。

- [ ] **Step 4: 检查变更边界**

Run: `git diff --check && git status --short`
Expected: no whitespace errors；只包含手册、相关测试及设计/计划文档。
