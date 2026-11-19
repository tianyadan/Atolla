# iOS Live Activity Energy Optimization Implementation Plan

**Goal:** 在保留灵动岛与锁屏关键状态展示的前提下，移除无视觉收益的高频刷新，降低 iOS 前后台网络、CPU 与 ActivityKit 唤醒。

**Architecture:** 由业务状态变化驱动 Live Activity 更新，原生层负责稳定签名、阈值过滤与短窗口合并；系统计时视图负责耗时和倒计时。前台仅保留 30 秒低频校准，后台停止 WebView 轮询和额外后台任务，展示最后一次真实状态并设置过期时间。

**Tech Stack:** Swift、ActivityKit、WidgetKit、SwiftUI、React、TypeScript、Capacitor

**Spec:** `docs/superpowers/specs/2026-11-17-ios-live-activity-energy-design.md`

## Global Constraints

- 不改变 Agent 执行协议、任务状态语义和 Go 后端接口。
- 不用普通后台线程、WebView Timer 或局域网长连接承诺后台实时刷新。
- 错误、审批、完成和取消必须立即收敛；普通进度允许合并和阈值过滤。
- 同一展示状态不得因为时间戳或动画相位重复调用 `Activity.update`。
- 保留现有灵动岛、锁屏和深链展示能力。

---

### Task 1: 移除 ActivityKit 高频动画更新

**Files:**
- Modify: `remote-relay/web/ios/App/App/AtollaIslandPlugin.swift`
- Modify: `remote-relay/web/ios/App/AtollaIslandWidget/AtollaBusyLiveActivity.swift`

- [ ] 删除 `animTimer`、`startAnimTimer`、`tickAnim`、`updateAnimTimer` 及相关生命周期调用。
- [ ] 水母稳定状态使用静态展示；仅在内容状态变化时使用一次性 SwiftUI transition。
- [ ] 保持 `animPhase` 的协议兼容读取，不再以它触发 Activity 更新。

### Task 2: 增加状态去重、进度阈值与事件合并

**Files:**
- Modify: `remote-relay/web/ios/App/App/AtollaIslandPlugin.swift`
- Test: `remote-relay/web/ios/App/AppTests/AtollaIslandPluginTests.swift`

- [ ] 为影响展示的字段生成稳定签名，排除 `updatedAt` 等纯时间字段。
- [ ] 普通进度仅在跨越 5 个百分点、步骤变化或文案变化时提交更新。
- [ ] 对连续普通事件增加 2 秒合并窗口；错误、审批、完成和取消绕过窗口立即更新。
- [ ] 在活动结束、App 生命周期变化和插件释放时取消待提交事件，避免过期写入。

### Task 3: 收敛原生刷新与后台生命周期

**Files:**
- Modify: `remote-relay/web/ios/App/App/AtollaIslandPlugin.swift`
- Modify: `remote-relay/web/ios/App/App/AtollaIslandRemoteRefresh.swift`

- [ ] 将 5 秒内容刷新改为仅前台、存在活动时运行的 30 秒校准。
- [ ] 进入后台时停止内容 Timer、孤儿巡检和额外 `UIBackgroundTask`，只提交一次暂停后的最后真实状态。
- [ ] 回到前台时立即校准一次，再恢复低频兜底。
- [ ] 根据运行、审批和终态设置明确 `staleDate`，禁止后台伪造持续进度。

### Task 4: 停止 WebView 后台轮询并接入事件失效

**Files:**
- Modify: `remote-relay/web/src/components/IslandBusySyncHost.tsx`
- Modify: `remote-relay/web/src/islandLiveActivity.ts`
- Test: `remote-relay/web/src/components/IslandBusySyncHost.test.tsx`
- Test: `remote-relay/web/src/islandLiveActivity.test.ts`

- [ ] 移除后台 5 秒轮询和原生 `refreshNeeded` 心跳监听。
- [ ] 前台使用业务失效事件立即同步，并保留 30 秒低频校准。
- [ ] App 进入后台时停止轮询；恢复前台时立即执行一次全量同步。
- [ ] 在 TypeScript 层保留完全相同内容去重，避免跨桥接无效调用。

### Task 5: 系统计时与视觉回归

**Files:**
- Modify: `remote-relay/web/ios/App/AtollaIslandWidget/AtollaBusyLiveActivity.swift`

- [ ] 审批倒计时继续使用 `Text(timerInterval:)`。
- [ ] 运行耗时改用系统计时视图，不通过 App Timer 刷新。
- [ ] 验证紧凑态、最小态、展开态与锁屏的宽度、截断、颜色和静态水母显示。
- [ ] 验证状态切换仅产生一次短过渡，不形成持续动画刷新。

### Task 6: 构建、真机与能耗验收

**Files:**
- No product file changes expected

- [ ] 执行相关 TypeScript 测试、lint 与 web build。
- [ ] 执行 iOS 单元测试和 Debug 真机构建。
- [ ] 真机验证运行、任务规划、审批、错误、完成、取消、锁屏及前后台切换。
- [ ] 使用 Instruments Energy Log 对同一任务运行 30 分钟，对比网络请求、CPU 唤醒和能耗等级。
- [ ] 确认稳定状态下 `Activity.update` 次数为零，前台兜底请求频率不高于每 30 秒一次，后台无本地轮询。

