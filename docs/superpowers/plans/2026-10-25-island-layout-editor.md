# 灵动岛可调布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AtollaIsland 支持悬停编辑、拖拽移动、独立或锁定比例缩放，并按显示器安全持久化用户布局。

**Architecture:** 将与 UI 无关的尺寸、位置、屏幕边界和持久化键抽到独立的 `IslandLayout` 值类型，使其可由 XCTest 覆盖。`IslandPanelController` 使用布局状态叠加现有 morph 动画尺寸，SwiftUI 编辑覆盖层只提交语义化的移动、缩放、锁定和重置操作，避免干扰现有事件点击。

**Tech Stack:** Swift 5.9、SwiftUI、AppKit、XCTest、UserDefaults。

**Spec:** `docs/superpowers/specs/2026-10-25-island-layout-design.md`

## Global Constraints

- 支持 macOS 14 及以上，不引入第三方依赖。
- 默认继续使用刘海原生尺寸和顶部居中位置。
- 宽高比默认锁定；解锁后宽、高必须独立变化。
- 布局按显示器持久化，窗口必须保持在可见屏幕内。
- 编辑交互不能破坏现有主岛、副岛和展开内容的点击行为。

## Review Focus

- 外接屏或显示器重排后，旧位置应被钳制到新屏幕可见区域；由任务 1 的 `clamped` 测试覆盖。
- 极小或极大的拖拽尺寸应保持可操作，且不破坏面板；由任务 1 的最小/最大尺寸测试覆盖。
- 锁定比例时从任意边或角调整都应按初始比例变化；由任务 1 的等比缩放测试覆盖。
- 解锁比例时只修改被拖动轴的尺寸；由任务 1 的独立缩放测试覆盖。
- 动画展开/收起过程中，用户位置和尺寸偏好不得被重置；由任务 2 的布局状态集成检查覆盖。

---

### Task 1: 可测试的布局状态与持久化

**Files:**
- Create: `macos/AtollaIsland/Sources/AtollaIsland/IslandLayout.swift`
- Create: `macos/AtollaIsland/Tests/AtollaIslandTests/IslandLayoutTests.swift`
- Modify: `macos/AtollaIsland/Package.swift`

**Interfaces:**
- Produces: `IslandLayout`, `IslandLayoutStore`、`IslandResizeEdge`，供面板控制器和编辑覆盖层调用。

- [ ] **Step 1: 编写失败的布局单元测试**

覆盖默认顶部居中布局、屏幕可见区域钳制、最小/最大尺寸、锁定比例缩放、解锁时单轴缩放，以及按显示器标识持久化。

- [ ] **Step 2: 运行测试确认失败**

Run: `DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift test --package-path macos/AtollaIsland`

Expected: FAIL，因为 `IslandLayout`、`IslandLayoutStore` 和测试目标尚不存在。

- [ ] **Step 3: 实现布局模型与存储**

在 `IslandLayout.swift` 实现纯值类型几何计算：`frame(for:contentSize:screenFrame:visibleFrame:)`、`moved(by:)`、`resized(edge:translation:baseContentSize:)`、`clamped(to:)` 和 `reset()`。`IslandLayoutStore` 使用以显示器稳定标识为后缀的 `UserDefaults` 键，在拖拽结束后保存布局。

- [ ] **Step 4: 运行布局测试确认通过**

Run: `DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift test --package-path macos/AtollaIsland --filter IslandLayoutTests`

Expected: PASS。

### Task 2: 面板几何与动画集成

**Files:**
- Modify: `macos/AtollaIsland/Sources/AtollaIsland/IslandPanelController.swift`
- Modify: `macos/AtollaIsland/Sources/AtollaIsland/IslandViewModel.swift`
- Modify: `macos/AtollaIsland/Sources/AtollaIsland/IslandViews.swift`
- Test: `macos/AtollaIsland/Tests/AtollaIslandTests/IslandLayoutTests.swift`

**Interfaces:**
- Consumes: 任务 1 的 `IslandLayout` 和 `IslandLayoutStore`。
- Produces: 面板控制器的移动、缩放、锁定和复位入口，供 SwiftUI 编辑层回调。

- [ ] **Step 1: 增加失败的内容尺寸叠加测试**

新增测试，证明相同的用户布局倍率会同时应用于收起态和展开态内容尺寸，且位置不会因 morph 状态改变而丢失。

- [ ] **Step 2: 运行测试确认失败**

Run: `DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift test --package-path macos/AtollaIsland --filter IslandLayoutTests`

Expected: FAIL，因为内容尺寸叠加接口尚未实现。

- [ ] **Step 3: 接入布局状态到面板控制器**

在 `IslandPanelController` 中加载当前屏幕的布局偏好，以布局后的 content size 计算 `NSPanel` frame；显示器变化时重新加载对应布局并重建根视图。移动、缩放、切换比例锁定和复位均更新当前布局，拖拽结束才持久化。保留 `morph.onFrame` 的逐帧驱动，禁止额外动画。

- [ ] **Step 4: 运行测试与构建确认通过**

Run: `DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift test --package-path macos/AtollaIsland && DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift build -c release --package-path macos/AtollaIsland`

Expected: PASS，且 release build 成功。

### Task 3: 悬停式编辑覆盖层

**Files:**
- Modify: `macos/AtollaIsland/Sources/AtollaIsland/IslandViews.swift`
- Modify: `macos/AtollaIsland/Sources/AtollaIsland/IslandPanelController.swift`
- Modify: `macos/AtollaIsland/README.md`

**Interfaces:**
- Consumes: 任务 2 暴露的移动、缩放、锁定与复位回调。
- Produces: 悬停边框、移动握柄、八方向缩放手柄、比例锁定开关与双击复位。

- [ ] **Step 1: 增加编辑层回调的失败测试**

对编辑状态机写入测试：拖拽开始不持久化、拖拽结束持久化；锁定状态切换后下次缩放采用对应策略。

- [ ] **Step 2: 运行测试确认失败**

Run: `DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift test --package-path macos/AtollaIsland --filter IslandLayoutTests`

Expected: FAIL，因为编辑会话接口尚未实现。

- [ ] **Step 3: 实现悬停编辑交互**

在 `IslandRootView` 添加仅悬停可见的编辑覆盖层：边缘和角手柄负责 resize，顶部轻量握柄负责 move，锁按钮切换宽高比，双击握柄恢复默认布局。覆盖层避开主岛、副岛和展开内容点击热区，并在拖拽结束调用持久化回调。

- [ ] **Step 4: 更新使用说明并执行完整验证**

在 README 补充布局编辑操作和复位方式。

Run: `DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift test --package-path macos/AtollaIsland && DEVELOPER_DIR=/Users/tianhaowen/Downloads/Xcode.app/Contents/Developer swift build -c release --package-path macos/AtollaIsland`

Expected: PASS，且 release build 成功。

### Task 4: 完整性检查与提交

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-island-layout-design.md`
- Modify: `docs/superpowers/plans/2026-10-25-island-layout-editor.md`

- [ ] **Step 1: 复查实现与设计的对应关系**

确认移动、缩放、锁定比例、解锁独立缩放、按屏幕保存、屏幕内钳制、双击复位和原有点击行为均已落实。

- [ ] **Step 2: 检查变更范围与 Git 状态**

Run: `git diff --check && git status --short`

Expected: 无空白错误，且不暂存 `.atolla-chat-images/` 或 `.cursor/`。

- [ ] **Step 3: 提交并推送**

```bash
git add docs/superpowers macos/AtollaIsland
git commit -m "feat(island): add draggable layout controls"
git push origin main
```

Expected: 当前分支推送成功。
