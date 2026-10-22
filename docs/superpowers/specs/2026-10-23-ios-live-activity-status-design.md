# iOS 灵动岛多状态与未读队列设计

## 背景

Atolla iOS App 当前通过 ActivityKit 展示运行中的数字员工：移动端每 3 秒读取员工镜像，把忙碌员工同步给一个 Live Activity，并在灵动岛中展示水母、人数与运行时间。

现状已经具备 `task_unread`、`last_run_ms`、`last_error`、员工部门、待审批镜像和数字人对话页，但灵动岛只消费运行态，无法区分任务完成、命令待审批与任务报错，也没有按事件跳转和逐项已读能力。

## 目标

- 灵动岛统一展示四种状态，固定优先级为：`报错 > 命令审批 > 运行中 > 已完成`。
- 收缩态用系统化状态图标和数量表达当前最高优先级事件。
- 展开态展示数字人、部门、运行耗时、发生时间，以及错误或审批摘要。
- 点击事件跳转到对应数字人对话；审批事件定位并展开对应审批卡。
- 多个数字人的完成或报错事件逐项已读；同一数字人只保留最新一条未读。
- 复用单个 Live Activity，避免多个活动争抢灵动岛。
- 当前无 Apple Developer 证书，先交付本地同步版本，并为后续 APNs Live Activity 更新保留数据边界。

## 明确边界

- App 前台时按 3 秒周期同步，切回前台立即强制同步。
- App 刚进入后台时使用现有短时后台任务尽力更新。
- App 被系统挂起或被用户杀掉后，不能保证实时收到状态变化；灵动岛保留最后一次成功同步的状态。
- 不使用音频、定位等与产品功能无关的后台保活方式。
- 不在本期接入 APNs、Live Activity push token 或远程推送服务。
- iOS 的普通点击会打开 App，长按才展开灵动岛；产品不尝试改变系统手势。

## 已确认的业务规则

1. 当前展示类别由最高优先级决定，展开态只列出该类别的事件。
2. 高优先级事件清空后，下次同步自动降级到下一类别。
3. 同一数字人发生多次完成或报错时，只保留最新一次未读快照。
4. 运行中是实时状态，不属于未读，不能手动清除。
5. 完成或报错事件进入对应数字人对话后即视为已读。
6. 审批事件进入对话不算处理完成；只有允许、拒绝或过期后才移除。
7. 同一数字人的每个待审批请求按 `request_id` 独立保留。
8. 所有未读和待审批清空、且没有数字人运行时，立即结束 Live Activity。

## 总体架构

沿用“Mac Atolla → Remote Relay → Capacitor App → iOS ActivityKit”的现有链路：

```text
Mac Atolla
  ├─ 员工实时状态与最新未读快照
  └─ 待审批请求
          ↓ 镜像同步
Remote Relay
  ├─ agents_mirror.payload_json
  └─ permissions_mirror
          ↓ App 轮询
IslandActivitySyncHost
  ├─ 聚合四类 IslandEvent
  ├─ 执行优先级选择
  └─ 生成最多 5 条原生切片
          ↓ Capacitor 插件
单个 Activity<AtollaBusyAttributes>
  ├─ 收缩态
  ├─ 展开态
  └─ 锁屏实时活动
```

不新增单独的灵动岛事件镜像表。员工完成和报错使用员工镜像中的“最新未读快照”，审批继续使用现有审批镜像。

## 服务端数据模型

### managed_agents 扩展

保留现有 `task_unread` 兼容字段，并增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_unread_kind` | `VARCHAR(16)` | 空、`completed` 或 `error` |
| `task_unread_at` | `DATETIME NULL` | 最新完成或报错的发生时间 |
| `task_unread_duration_ms` | `INT NULL` | 该次任务执行耗时 |
| `task_unread_summary` | `TEXT NULL` | 报错原因快照；成功时为空 |

状态迁移规则：

- 工作态转为 `idle`：`task_unread=1`，写入 `completed` 快照。
- 工作态转为 `error`：`task_unread=1`，写入 `error` 快照并复制错误原因。
- 数字人开始下一次任务时不清除旧未读。
- 新任务结束时覆盖该数字人的旧未读快照。
- 已读操作同时清空 `task_unread` 和四个快照字段。
- 数据库迁移将历史 `task_unread=1` 数据按当前状态回填：当前为 `error` 时回填为错误，否则按完成回填；时间使用该行 `updated_at`，耗时使用 `last_run_ms`。

独立快照字段是必要的：员工开始新任务后，实时 `status` 和 `last_error` 可能变化，不能再依赖它们还原上一次未读事件。

### 员工镜像

在现有 `agents_mirror.payload_json` 中增加：

```json
{
  "task_unread": true,
  "task_unread_kind": "completed",
  "task_unread_at": 1792717200,
  "task_unread_duration_ms": 93210,
  "task_unread_summary": "",
  "folder_name": "研发部"
}
```

不修改 `agents_mirror` 表结构。

### 审批聚合接口

新增：

```text
GET /api/instances/:id/permissions/pending
```

返回当前实例所有未过期审批请求。现有按员工查询接口继续保留，聊天页行为不变。

## App 事件模型

App 内部统一使用：

```ts
type IslandEvent = {
  id: string
  type: 'error' | 'approval' | 'running' | 'completed'
  instanceId: string
  agentId: string
  agentName: string
  department: string
  conversationId?: number
  requestId?: string
  occurredAt: number
  durationMs?: number
  summary?: string
}
```

稳定 ID：

- 完成：`completed:{agentId}`。
- 报错：`error:{agentId}`。
- 运行中：`running:{agentId}`。
- 审批：`approval:{requestId}`。

排序规则：同一类别内按 `occurredAt` 倒序，最新事件排在最前。收缩态点击打开第一项。

## 聚合与同步

`IslandBusySyncHost` 升级为统一同步宿主：

1. 每 3 秒并行获取员工镜像和实例级待审批列表。
2. 从员工镜像生成报错未读、完成未读与运行中事件。
3. 从审批镜像生成审批事件。
4. 按 `error > approval > running > completed` 选出活动类别。
5. 详细切片最多发送 5 条，同时发送当前类别总数。
6. 生成稳定序列化 key；数据未变化时不调用 ActivityKit update。
7. 页面回到前台、实例切换、对话已读或审批完成时强制重新同步。
8. 本地深链进入完成/报错对话时先乐观移除对应事件；Mac 确认已读后的下一次镜像同步成为最终事实来源。

轮询失败时保留最近一次 Live Activity 状态，不用空结果覆盖。恢复成功后再纠正。

## ActivityKit 内容结构

继续保留 `AtollaBusyAttributes` 类型名，降低升级时遗留活动失配风险；扩展 `ContentState`：

```text
activeKind     error | approval | running | completed
count          当前类别总数
items          最多 5 条详细切片
animPhase      仅运行态使用
updatedAt      最近成功同步时间
```

单条切片包含事件 ID、类型、姓名、部门、发生时间、耗时、截断摘要、水母颜色和深链字符串。错误与命令摘要在进入原生层前限制长度，保证整个 ContentState 明显低于 ActivityKit 约 4 KB 的载荷限制。

只有 `activeKind=running` 时启动当前水母动画 Timer。其他状态停止 0.3 秒更新，避免无效耗电和 ActivityKit 更新限流。

## 视觉与交互

| 状态 | 主色 | 收缩态 | 展开态主要信息 |
|---|---|---|---|
| 报错 | 浅红 | 圆圈加叉号、数量 | 数字人、部门、耗时、错误摘要 |
| 待审批 | 浅黄 | 圆圈加叹号、数量 | 数字人、部门、命令摘要、等待时间 |
| 运行中 | 现有紫色 | 水母、数量 | 数字人、部门、实时运行时长 |
| 已完成 | 绿色 | 圆圈加对勾、数量 | 数字人、部门、执行耗时、完成时间 |

- 展开态最多显示 3 行，更多时展示“还有 N 项”。
- 错误和命令摘要只显示一行，完整内容进入 App 查看。
- iOS 17 及以上使用系统 Symbol Effect 表达状态符号出现；iOS 16.2 使用静态符号和普通状态替换。
- 锁屏 Live Activity 复用相同优先级、颜色和信息，不引入另一套规则。
- 动态岛行优先使用各自深链；系统不支持行级交互时，整个活动回退到当前第一项深链。

## 深链与导航

统一 URL：

```text
atolla://agent/{instanceId}/{agentId}/chat
atolla://approval/{instanceId}/{agentId}/{requestId}
```

App 顶层监听 Capacitor `appUrlOpen`：

1. 校验 scheme、路径和参数，拒绝未知路由。
2. 如果实例未解锁，暂存目标并进入解锁流程。
3. 解锁成功后恢复目标路由。
4. 数字人链接进入现有聊天路由。
5. 审批链接进入聊天路由，并通过 location state 或查询参数指定 `requestId`。
6. 聊天页加载审批队列后滚动并展开目标审批卡。

进入完成或报错数字人对话后，复用 viewer/mark-read 链路清除服务端未读。审批深链不触发任务未读清理之外的审批删除；审批记录仍由审批结果或过期逻辑清除。

## 兼容性与迁移

- 旧 App 继续只读取已有忙碌字段，不受新增 payload 影响。
- 新 App 面对未升级的 Mac 时，没有 `task_unread_kind` 就只展示现有运行态，不把未知未读误判为完成。
- 新 Relay 兼容旧 Mac，新增实例级审批接口只聚合已经存在的镜像行。
- 升级 App 时先结束旧 schema 的活动，再由新插件按新 ContentState 创建活动；失败时不影响 App 主功能。

## 错误处理

- Live Activity 未授权：记录现有错误提示，不影响消息和审批功能。
- 原生插件更新失败：不更新去重 key，下个轮询周期重试。
- 员工不存在或已删除：过滤对应孤立审批和未读事件。
- 深链指向已处理审批：进入数字人对话并提示“该审批已处理或已过期”。
- 摘要为空：分别回退为“任务执行失败”或“有命令等待审批”。
- 时间或耗时缺失：显示短横线，不伪造数值。

## 影响范围

### Mac Atolla / Go

- `server/internal/store/managed_agents.go`
- `server/internal/store/store.go` 或独立迁移文件
- `server/internal/remotebridge/handlers.go`
- 相关 Store、Service 和 Handler 测试

### Remote Relay

- `remote-relay/server/src/mirror.ts`
- `remote-relay/server/src/routes/site.ts`
- 对应 API 与镜像测试

### Capacitor Web App

- `remote-relay/web/src/islandLiveActivity.ts`
- `remote-relay/web/src/components/IslandBusySyncHost.tsx`
- `remote-relay/web/src/api.ts`
- `remote-relay/web/src/App.tsx`
- `remote-relay/web/src/pages/ChatHistory.tsx`
- 状态聚合和深链单元测试

### iOS

- `remote-relay/web/ios/App/App/AtollaBusyAttributes.swift`
- `remote-relay/web/ios/App/App/AtollaIslandPlugin.swift`
- `remote-relay/web/ios/App/AtollaIslandWidget/AtollaBusyLiveActivity.swift`

## 测试方案

### Go

- 工作态到 `idle` 生成完成未读快照。
- 工作态到 `error` 生成错误未读快照。
- 同一员工后一次结束覆盖前一次未读。
- 开始新任务不提前清除旧未读。
- mark-read 完整清除快照字段。
- 旧数据迁移和幂等迁移。
- 镜像 payload 包含完整快照和部门。

### Relay / TypeScript

- 实例级审批接口只返回目标实例、未过期的审批。
- 四类事件转换正确。
- 混合状态严格遵循优先级。
- 同类按发生时间倒序。
- 同一员工完成或报错只生成一个事件。
- 5 条切片限制和总数正确。
- 深链解析、未解锁恢复和非法 URL 拒绝。
- 进入对话后的乐观移除与下一次镜像对账。

### Swift / 手工验收

- 四种收缩态图标、颜色和数量。
- 展开态单项、多项以及“还有 N 项”。
- 运行态动画只在运行类别启动。
- 高优先级清除后降级展示下一类别。
- 点击完成、报错、审批分别到达正确位置。
- App 前台、刚切后台、系统挂起后再回前台三种场景符合已声明边界。
- iOS 16.2 静态回退和 iOS 17+ Symbol Effect。

## 验收标准

1. 报错、审批、运行、完成同时存在时，灵动岛只展示报错。
2. 报错逐项进入对话并已读后，自动切换到审批；审批全部处理后依次切换到运行和完成。
3. 多个员工完成时可逐个查看、逐个消失；同一员工连续完成只显示最新一次。
4. 展开态显示的数据与服务端真实员工、部门、耗时、时间和错误原因一致。
5. 深链在已解锁和未解锁两种情况下都能最终进入正确目标。
6. 无待处理事件且无人运行时 Live Activity 结束。
7. 长期后台不实时更新被视为无开发者证书版本的已知限制，而不是缺陷。

