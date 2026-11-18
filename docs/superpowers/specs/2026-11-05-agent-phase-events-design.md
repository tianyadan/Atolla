# Agent Phase Events Design

## Intent

让运行中的数字员工头像跟随 CLI 真实事件，在思考、工具执行、输出回复、等待交互之间切换，而不是整轮只显示同一种上下跳动动画。

## Design

- Go Agent 层新增独立的 `PhaseEvent/PhaseFn`，统一阶段为 `thinking`、`working`、`responding`、`waiting`、`idle`、`error`。
- Cursor、Codex、Claude 各自解析原生 JSONL/stream-json 事件并转换阶段；原始事件未明确下一阶段时不推测。
- Service 将阶段转换为 SSE `agent_phase`；前端会话态保存当前阶段并驱动现有 `JellyAvatar`。
- `thinking` 使用 `ponder`；`working/responding` 保留现有跳动；`waiting/error/idle` 使用已有动画。

## Constraints

- 不修改或注入三个 CLI，不伪造缺失事件。
- 不改变现有文本流、工具明细、命令审批、Usage 和任务终态逻辑。
- 数字人列表仍以业务状态为准；阶段动画只作用于当前对话运行态展示。

## Alternatives

- 复用 `Activity`：字段语义混杂，工具完成后容易错误推断状态，因此不采用。
- 前端从工具文案推断：依赖中文字符串且无法识别真实 thinking，因此不采用。
- 独立阶段事件：保持适配层职责清晰，选用此方案。
