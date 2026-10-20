# 数字员工审计看板设计

日期：2026-10-20  
状态：已确认（待写实现计划）

## 背景

管理台侧栏现有「统计」页，只按日期 / IP 汇总成功失败，无法支撑数字员工运维所需的执行次数、状态、耗时、Token、工具与错误分析。另有「对话审计」页，仅覆盖前台访客 Ask，与数字员工链路分离。

## 目标

1. 将侧栏「统计」改名为「审计」，做成数字员工执行审计看板（布局：概览优先）。
2. 从现在起为数字员工 Ask 落库审计；看板只展示落库之后的数据，不回填历史。
3. 覆盖入口：后台「数字人 → 对话」与手机远程中继发起的 Ask。
4. 不覆盖：项目协作工作流节点执行；前台「对话审计」保持独立、不改语义。

## 非目标

- 不改造前台 `visitor_ask_logs` /「对话审计」页面。
- 不把工作流 `node_executions` 并入本看板。
- 不回填改造前的历史会话 / Token。
- 第一版不做导出 CSV、不做实时 WebSocket 推送（刷新拉取即可）。

## 范围与指标

| 功能 | 统计内容 | 维度 |
|------|----------|------|
| 执行次数 | 总次数、正常完成次数、失败次数 | 数字员工 |
| 执行状态 | 完成、失败、超时、取消、中断 | 每轮执行 |
| 执行耗时 | 每轮耗时、平均耗时 | 数字员工 |
| Token 消耗 | Input、Output、总 Token | 每轮执行 |
| 每日 Token | 每天消耗多少 Token | 数字员工 + 日期 |
| 每周 Token | 每周消耗多少 Token | 数字员工 + 自然周 |
| 工具调用 | 工具名称、调用次数、结果、耗时 | 数字员工 + 工具 |
| TOP 3 工具 | 调用次数最多的三个工具 | 数字员工 |
| 错误记录 | 错误类型、错误信息、发生时间 | 每轮执行 |

状态枚举（落库值）：

- `completed` — 正常完成  
- `failed` — 失败  
- `timeout` — 超时  
- `cancelled` — 取消  
- `interrupted` — 中断  

「失败次数」顶栏口径：`failed + timeout`（取消 / 中断单独在状态分布中展示，避免与「失败」混计）。

## 架构

```
后台 Ask / 手机中继 Ask
        │
        ▼
 askManagedCore（统一收口）
        │  begin → finish
        ▼
 agent_ask_logs  +  agent_ask_tool_calls
        │
        ▼
 GET /api/admin/agent-audit/*
        │
        ▼
 侧栏「审计」页面（ECharts 概览）
```

与现有「对话审计」平行：访客走 `visitor_ask_logs`，数字员工走本设计的两张表。

## 数据模型

### `agent_ask_logs`

每轮 Ask 一条。

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `agent_id` | 数字员工 |
| `conversation_id` | 会话 |
| `user_message_id` | 用户消息（可空） |
| `source` | `admin` \| `mobile` |
| `status` | 见状态枚举；进行中可用 `processing` 仅作中间态，看板默认排除 |
| `duration_ms` | 本轮耗时 |
| `input_tokens` / `output_tokens` / `total_tokens` | Token；缓存类若引擎有上报可并入 input 或单独列，第一版至少保证三者 |
| `error_type` / `error_message` | 非成功时填写 |
| `started_at` / `finished_at` / `created_at` | 时间 |

索引建议：`(agent_id, started_at)`、`(started_at)`、`(status, started_at)`。

### `agent_ask_tool_calls`

一轮多条工具调用。

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `ask_log_id` | 归属轮次 |
| `agent_id` | 冗余便于按员工聚合 |
| `tool_name` | 工具名 |
| `result` | `ok` \| `error` \| `denied` |
| `duration_ms` | 单次工具耗时（拿不到则 0） |
| `created_at` | 发生时间 |

索引建议：`(ask_log_id)`、`(agent_id, tool_name)`、`(agent_id, created_at)`。

### 写入时机

1. Ask 开始（用户消息落库后）：`BeginAgentAskLog` → `status=processing`。  
2. 本轮工具事件：追加 `agent_ask_tool_calls`（审批拒绝记 `denied`）。  
3. Ask 结束：`FinishAgentAskLog` 写状态、Token、耗时、错误。  
4. 进程崩溃导致长期 `processing`：看板默认过滤；可选后续再做超时回收（本版不做自动改写）。

写入失败只打日志，不阻断主对话链路（与前台访客审计一致）。

## API

均需管理员 JWT。查询参数公共部分：

- `agent_id`：可选，0 / 省略 = 全部  
- `from` / `to`：日期或 RFC3339；默认近 7 天  
- 自然周：周一为周起点；日期按服务器本地日历日聚合（与现有 `StatsByDay` 一致，不强制转换时区）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/admin/agent-audit/overview` | 顶栏：总次数、完成、失败、总 Token；状态分布；TOP 3 工具；平均耗时 |
| GET | `/api/admin/agent-audit/tokens/daily` | 每日 Token（input/output/total）按员工筛选 |
| GET | `/api/admin/agent-audit/tokens/weekly` | 每周 Token |
| GET | `/api/admin/agent-audit/tools` | 按工具聚合：名称、次数、结果分布、平均耗时 |
| GET | `/api/admin/agent-audit/errors` | 最近错误列表（分页可选，默认 20） |

旧接口 `/api/admin/stats*` 本版从管理台入口移除；后端可暂留以免破坏外部调用，UI 不再使用。

## 前端

### 导航

- `ADMIN_MENUS` 中 `{ id: 'stats', label: '统计' }` 改为 `{ id: 'audit-agents', label: '审计' }`（新 id，避免与「对话审计」的 `audit` 混淆）。  
- 删除旧按日 / IP 展开表格 UI。  
- 「对话审计」(`audit` + `VisitorAskAudit`) 不动。

### 布局（已确认：概览优先）

1. 筛选条：员工下拉 + 近 7 天 / 近 30 天 / 自定义。  
2. 顶栏 4 卡：总次数、正常完成、失败、总 Token。  
3. 中左：每日 Token 折线（ECharts）。  
4. 中右：执行状态饼图 / 环图。  
5. 下左：TOP 3 工具条形图；旁注平均耗时。  
6. 下右：最近错误列表。  
7. 次要区（折叠或同页靠下）：每周 Token、工具调用表、执行耗时说明。

视觉原则：指标简约清晰；ECharts 按需使用；配色跟随现有管理台，避免花哨多色块。

依赖：若仓库尚未引入 ECharts，在 `web` 管理端按需增加 `echarts`（或已有图表库则复用；以 package.json 为准，无则新增）。

## 错误与边界

- Token 引擎未回传：记 0，不伪造。  
- 工具耗时拿不到：`duration_ms=0`，聚合时仍计次数。  
- `processing` 不计入「总次数」完成态统计；总次数 = 已结束轮次（五种终态）。  
- 手机与后台同一 `agent_id` 合并统计；`source` 可供后续筛选，第一版 UI 可不暴露。

## 测试

- Store：Begin/Finish、工具插入、按员工/日期聚合 SQL。  
- Service：Ask 成功 / 失败 / 取消路径会写审计；写入失败不影响 Ask 返回。  
- Handler：overview / daily / errors 鉴权与空数据。  
- 前端：无数据空态；有 mock 数据时卡片与图表渲染（手工或轻量组件测）。

## 实施顺序建议

1. 建表 + Store CRUD/聚合。  
2. 在 `askManagedCore`（及中继入口）挂钩写入。  
3. Admin API。  
4. 替换「统计」为审计看板页。  
5. 联调后台与手机各一轮 Ask，确认出现在看板上。
