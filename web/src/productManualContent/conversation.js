import { manualArticle } from './article.js'

export const conversationItems = [
  {
    id: 'conversation-session', categoryId: 'conversation', label: '对话创建与恢复', description: '实例、员工和会话的隔离关系',
    content: manualArticle(
      '对话创建与恢复',
      '每个数字员工都有自己的对话，同一员工还可以拥有多个线程。PC 和移动端打开时，平台优先恢复该实例下最近使用的员工及其最近会话。',
      '启动或切换实例\n        ↓\n读取 instance_id 下的员工镜像\n        ↓\n查找最近员工与 conversation_id\n        ├─ 均可用 → 恢复历史与输入区\n        ├─ 员工不存在 → 要求重新选择\n        └─ 无员工 → 展示招聘引导',
      '`conversations` 保存平台会话，`managed_agents` 保存员工主会话关联。现代工作台从 `/api/admin/agent-conversations` 读取去重后的摘要，切换员工时优先激活其最近对话。移动端的恢复键同时包含实例 ID、员工 ID 和会话 ID，避免跨实例复用。',
      '- 实例离线时应显示离线原因，不能静默跳到另一实例。\n- 正在执行的员工允许打开查看，但切换会话不应改变后端任务的归属。\n- 会话 ID 不是全局可随意复用的路由参数，必须与实例和员工关系一起校验。',
    ),
  },
  {
    id: 'conversation-streaming', categoryId: 'conversation', label: 'SSE 流式执行', description: '增量输出、工具事件和最终结果',
    content: manualArticle(
      'SSE 流式执行',
      '任务开始后，数字员工的思考文本、工具调用、命令状态和最终回答会逐步进入对话，用户不必等待整个 CLI 进程结束。',
      '用户提交任务\n        ↓\nAskManagedBackground 启动独立运行上下文\n        ↓\n引擎 stdout JSONL → 统一 AskEvent\n        ↓\nHub/SSE 广播 text、tool、command、usage、plan\n        ↓\n前端按 message/event ID 合并时间线\n        ↓\n最终回答落库 + 终态通知',
      '`askManagedCore` 统一设置员工忙碌状态、构建提示和调用 agent 适配器。事件接收器把增量文本发给 SSE，同时将命令和工具事件写入审计。结束阶段使用脱离 HTTP 请求的上下文保存用户问题和助手结果，减少前端断开导致的丢失。',
      '- SSE 断开不等于后端任务被取消；用户稍后可从持久化消息恢复。\n- 引擎可能先流式输出正文，最后再返回完整 result，前端必须去重而不是再追加一遍。\n- “已授权”和“命令已执行完成”是两种事件，时间线不应混合。',
    ),
  },
  {
    id: 'conversation-task-plan', categoryId: 'conversation', label: '任务规划', description: '阶段、步骤和进度状态',
    content: manualArticle(
      '任务规划',
      '开启“任务规划”后，平台会把长任务的阶段和当前步骤作为结构化状态展示，让用户区分正在制定计划、正在执行与已经收尾。',
      '发送时开启 task_plan\n        ↓\n运行态 planning\n        ↓\n引擎生成/更新步骤 → running(step, total)\n        ↓\n步骤事件通过 SSE 更新规划卡\n        ↓\n成功 → done\n异常或终止 → failed / interrupted',
      '任务进度使用 `atolla.task_plan.v1` 结构，同时服务 PC 对话和灵动岛。后端只在收到真实规划或步骤事件时推进阶段，不用纯时间动画伪造完成度。最终结果会将计划状态收口为成功、失败或中断。',
      '- 进度是引擎报告的计划步骤，不是按字节、Token 或时间计算的精确百分比。\n- 未开启任务规划时，正常的流式对话、命令审批和结果保存仍然生效。\n- 中断后的已完成步骤是历史记录，不保证重试时原样复用。',
    ),
  },
  {
    id: 'conversation-task-queue', categoryId: 'conversation', label: '任务队列', description: '打断优先、加入队列和继续执行',
    content: manualArticle(
      '任务队列',
      '同一数字员工忙碌时再发送任务，用户可选择打断当前任务并优先处理新任务，或将新任务加入持久化队列。队列让员工按顺序工作，不会并发污染同一对话。',
      '忙碌员工收到新任务\n        ├─ 打断优先 → 新任务入队头 → Stop 当前任务\n        └─ 加入队列 → queued 持久化\n                              ↓\n当前任务终态 → claimNextIfIdle\n        ↓\nqueued → running → done / failed\n手动 Stop → hold → 用户点击继续队列',
      '`agent_task_queue` 表记录问题、附件、状态和排序。服务层对每个员工使用独立锁，避免终态与新入队同时抢占。正常结束会领取下一项；用户明确 Stop 会暂停队列，防止“刚停下又自动开始”。启动时会修复异常留下的运行态。',
      '- 入队成功不等于任务已开始，界面应显示“已加入队列”而不是长期“发送中”。\n- 只能修改或取消尚未执行的队列项，运行中任务需使用 Stop。\n- 队列调度不改变权限网关；每一项真正执行时仍要独立审批命令。',
    ),
  },
  {
    id: 'conversation-attachments', categoryId: 'conversation', label: '图片与附件', description: '上传、压缩、OSS 和本机图片回显',
    content: manualArticle(
      '图片与附件',
      '用户可在发送前粘贴、拖入或选择图片，先在输入区预览、放大或删除。图片会在本地压缩和持久化，配置 OSS 时可同步为远程可访问地址。',
      '选图 / 粘贴 / 拖入\n        ↓\n前端预览 + 数量/类型检查\n        ↓\n上传 API → 压缩 → 本地 chat-images\n        └─ 可选 OSS 上传\n        ↓\n附件与问题一起进入引擎\n        ↓\n消息 meta_json 保存 → 历史缩略图/灯箱',
      '`ChatImageUI` 管理发送前预览与 Lightbox，后端 `SaveChatImage` 校验原始大小、压缩并生成附件元数据。Claude 可直接接收多模态附件；Codex/Cursor 优先通过工作区可读路径传递。对于 Codex/Cursor 回答中的合法本机图片路径，平台会在主目录或工作区白名单内解析并回显。',
      '- 单次最多六张，过大、空文件或不支持类型会被拒绝。\n- 本机路径回显会拒绝 `.ssh`、`.aws`、Keychains 等敏感目录，且不会读取主目录/工作区之外的文件。\n- OSS 失败时本地附件仍可用于本机对话，但远程端可能无法直接打开。',
    ),
  },
  {
    id: 'conversation-timeline', categoryId: 'conversation', label: '对话时间线', description: '消息、命令、终止、重试与耗时',
    content: manualArticle(
      '对话时间线',
      '对话时间线不只展示问答，还把工具调用、命令审批、执行结果、附件和任务终态放在同一条可追溯时间线上。',
      '本地乐观用户气泡\n        ↓\n数据库 messages + SSE 增量事件\n        ↓\ncoalesceChatLog 按 ID/角色/内容合并\n        ↓\n普通文本 | Markdown | 图片 | 命令卡 | 系统状态\n        ↓\n终止/重试时保留已产生内容\n        ↓\n用最终耗时与状态收口',
      '前端先放入乐观用户气泡，收到持久化消息后再替换。`coalesceChatLog` 避免流式正文、最终 result 和数据库回读重复展示，同时不让本地命令气泡顶掉最终助手回答。执行完成的命令默认折叠，待审批命令保持展开。',
      '- 时间线是组合视图，命令审计的完整风险和决策字段仍以审计记录为准。\n- Stop 只保证发送中断信号，已经由外部命令产生的副作用不会自动回滚。\n- 重试是新的执行轮次，旧轮次保留作为历史，不覆盖原错误。',
    ),
  },
]
