# Atolla 像素水母动画接入提示词（给实现用）

把下面整段复制给云端 agent / Cursor，在仓库里实现即可。素材已在分支 `chore/jelly-anim-pack` 的 `design/jelly-animations-pack/`。

---

## 目标

在现有 `feat/jelly-avatar`（或已合入的水母头像）基础上，接入七种像素水母动画。素材与配置已备好，**不要重画精灵图**；按配置切行 + CSS 位移。动画逻辑拆到独立文件（如 `web/src/jelly-animations/`），不要新开无关大分支（可直接在当前水母分支上改，或基于本 pack 分支继续）。

## 素材位置

- 精灵图：`design/jelly-animations-pack/sprites/jelly-{color}@{16|32|48}.png`
- 接入时复制到：`web/public/jelly-sprites/`（覆盖/升级现有两行图为七行图）
- 配置：`design/jelly-animations-pack/config/animations.json` 以及各 `config/<action>.json`
- 本地预览：打开 `design/jelly-animations-pack/preview.html`

布局：每张图 **8 列（帧）× 7 行（动作）**，cell=16。行号：

| row | id | 中文 |
|-----|-----|------|
| 0 | idle | 漂浮 |
| 1 | typing | 跳动/思考 |
| 2 | sleep | 睡觉 |
| 3 | eat | 吃饭/喂食 |
| 4 | alert | 等你拍板 |
| 5 | error | 出错 |
| 6 | celebrate | 庆祝 |

颜色：`orange|yellow|blue|green|purple|red`（字段仍为 `jelly_color`）。

## 要实现的前端接口（建议）

### 1. 动画模块 `web/src/jelly-animations/`

- `index.js`：导出 `JELLY_ACTIONS`、`getActionConfig(id)`、`resolveJellyAction({ agentStatus, loading, streaming, ui })`
- 每个动作一个文件：`idle.js` `typing.js` `sleep.js` `eat.js` `alert.js` `error.js` `celebrate.js`  
  内容：从 `animations.json` 读或内联同等字段：`id, row, frames=8, fps, loop, cssHint, trigger`
- `motion.css`（或独立 css）：按配置写 keyframes（idle bob、typing jump、sleep 轻漂、alert 闪、error 下沉等）

### 2. `JellyAvatar` 扩展

Props 建议：

```ts
{
  color: JellyColor
  size?: number
  // 优先用 action；也可用 state 做兼容映射
  action?: 'idle'|'typing'|'sleep'|'eat'|'alert'|'error'|'celebrate'
  state?: 'idle'|'working'|'typing'|'waiting'|'error' // 旧 API，映射到 action
  onClick?: () => void  // sleep 时点击 → 叫醒
  playOnceKey?: string|number // 变化时重播 eat/celebrate/error
}
```

行为：

- 用 `background-position` 切帧：`x = -frame*size`，`y = -row*size`，`background-size = (8*size) × (7*size)`
- `image-rendering: pixelated`
- 尊重 `prefers-reduced-motion`：停位移与闪烁，定格第 0 帧
- `loop:false` 的动作播完定格末帧或回 `idle`（eat/celebrate 回 idle；error 可定格末帧）

### 3. 状态映射（业务接口）

对接后端 SSE（PR #2）`agent.status`：

| 后端 / 场景 | action |
|-------------|--------|
| idle | idle（若前端判定长时间空闲可切 sleep） |
| working / 对话输出中 | typing |
| waiting（等审批） | alert |
| error | error |
| 任务成功结束 / 招聘成功 | celebrate（播一次） |
| 用户点「喂食」 | eat（播一次） |
| sleep 中点击头像 | → idle |

前端触发、暂不需新后端字段：`sleep`、`eat`、`celebrate`（celebrate 也可由前端在「成功」回调里播）。

颜色字段继续用已有 adapter：`jelly_color`；缺省 `id % 6`。

### 4. UI 挂载点

- 对话旁小水母、thinking 行：typing / idle / alert / error
- 员工列表 / 卡片：随 agent 状态
- 可选：头像点击喂食（eat）、长空闲 sleep

### 5. 验收

- `/?jellyPreview=1` 或扩展预览：七动作可切换
- 构建与现有 jelly 单测通过；为 `resolveJellyAction` 补单测
- 草稿 PR，勿合并；说明依赖 PR #2 状态流才能驱动 alert/error 真状态

## 明确不要做

- 不要改成 SVG / Canvas 重画
- 不要新后端接口（除非以后要持久化 sleep）
- 不要删除六色选色与 `jelly_color` adapter
- 不要合并 PR，保持 draft

---
