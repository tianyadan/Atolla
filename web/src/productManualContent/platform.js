import { manualArticle } from './article.js'

export const platformItems = [
  {
    id: 'platform-onboarding',
    categoryId: 'platform',
    label: '首次启动',
    description: '环境检测、注册与会话恢复',
    content: manualArticle(
      '首次启动',
      'Atolla 是本机运行的数字员工平台。首次打开时，它先确认后端、数据库和至少一种工作引擎可用，再引导创建管理员账号。后续启动会优先恢复登录态和最近使用的数字员工对话。',
      '启动 Go 后端与 React 前端\n        ↓\n读取 .env 与数据库 → 执行迁移\n        ↓\n检测 claude / codex / agent 命令\n        ↓\n未注册 → 创建管理员\n已注册 → 验证本地 Token\n        ↓\n进入现代对话工作台',
      '前端 `App.jsx` 使用本地 Token 请求 `/api/auth/me`，无管理员时展示注册流程。`EngineOnboarding` 读取后端引擎检测结果，缺少引擎时给出锁定版本的安装命令和国内镜像命令。启动脚本支持前台和 daemon 模式；后台守护另由设置页开关管理。',
      '- Atolla 不会自动为 Claude、Codex 或 Cursor 购买账号，引擎需先在本机可用并完成自身登录。\n- 首次检测通过只代表命令可找到，不代表订阅额度、网络或凭据永远有效。\n- 未绑定实例的移动端会先进入实例管理，不会静默选择其他电脑。',
    ),
  },
  {
    id: 'platform-engines',
    categoryId: 'platform',
    label: '工作引擎',
    description: 'Claude、Codex 与 Cursor 统一适配',
    content: manualArticle(
      '工作引擎',
      '数字员工不内置模型，而是调用用户电脑上已登录的 Claude Code、Codex CLI 或 Cursor Agent。平台把三种 CLI 的输出归一为文本、工具、命令、用量和会话事件。',
      '数字员工选择 engine\n        ↓\nagent.Run 创建引擎适配器\n        ↓\nClaude: stream-json + hooks\nCodex: exec --json + resume\nCursor: agent JSON + resume\n        ↓\n统一 AskEvent → SSE → 对话时间线',
      '`server/internal/agent` 内的适配器负责组装命令、系统提示、工作区与继续会话参数。解析层将不同 JSONL 格式转成统一事件，`service` 层负责存储消息、绑定 `engine_session_id` 并向前端推流。引擎不支持的事件不会被伪装为执行前拦截。',
      '- 三种引擎的原生能力不完全相同，特别是 Hook、沙箱、图片和用量接口。\n- 切换数字员工的引擎不会把原引擎 Session 转换成另一种引擎的 Session。\n- 事后从 JSONL 观察到的命令不等于平台已在执行前拦截它。',
    ),
  },
  {
    id: 'platform-engine-usage',
    categoryId: 'platform',
    label: '引擎用量',
    description: '订阅额度、窗口与重置周期',
    content: manualArticle(
      '引擎用量',
      '设置页的引擎卡片会展示本机账号可获取的用量窗口，用于判断任务中断是平台问题还是订阅额度不足。它是观测信息，不参与任务调度。',
      '用户打开工作引擎设置\n        ↓\n/api/admin/engines/usage\n        ↓\n读取本机已登录凭据或 CLI 用量源\n        ↓\n统一为主窗口 / 次窗口 / 重置时间\n        ↓\nEngineUsageChip 展示进度',
      '`internal/engineusage` 为各引擎提供独立探测器，并通过带超时的 HTTP/CLI 读取完成归一。前端保留缓存结果，用户可显式刷新。用量详情保留数据源和重置说明，避免只用一个百分比误导用户。',
      '- 只读取本机已登录状态，不会修改引擎账号、订阅或 Token。\n- 引擎供应商没有稳定用量接口时，界面会显示不可用或上次结果，不应将其解释为剩余额度为零。\n- 用量进度不会自动暂停或改派正在运行的任务。',
    ),
  },
  {
    id: 'platform-database',
    categoryId: 'platform',
    label: '数据库模式',
    description: 'SQLite、MySQL 与迁移重启',
    content: manualArticle(
      '数据库模式',
      'Atolla 默认使用本地 SQLite，无需 Docker 即可完成数字员工、对话、审批和队列的持久化。需要外部 MySQL 时，设置页可验证连接并执行数据迁移。',
      '设置页选择 SQLite 或 MySQL\n        ↓\n验证 DSN / 连接目标\n        ↓\n迁移表结构与业务数据\n        ↓\n写入 .env 数据库配置\n        ↓\n异步重启 → /health 检查\n        ↓\n新驱动提供后续读写',
      '`dbconfig` 负责连接参数和驱动选择，`dbmigrate` 保证两种驱动下的表结构一致。切换时先测试目标库，再迁移、更新配置和重启。如果运行方式无法由平台自行重启，响应会返回明确的手动命令。',
      '- 切换数据库是运维操作，执行前应保证目标库权限、磁盘和备份可用。\n- 连接测试成功不代表迁移中不会出现网络中断或容量问题。\n- 数据库模式只改变 Atolla 平台数据，不会自动搬运数字员工工作区里的文件。',
    ),
  },
]
