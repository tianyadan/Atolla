import { manualArticle } from './article.js'

export const observabilityItems = [
  {
    id: 'observability-bark', categoryId: 'observability', label: 'Bark 通知', description: '完成、待审批、报错和抑制规则',
    content: manualArticle(
      'Bark 通知',
      'Bark 用于在用户离开当前对话后提醒任务完成、命令待审批或执行报错。通知标题标明 Atolla 和事件类型，正文包含数字员工名称与必要摘要，并可携带 Atolla 图标和深链。',
      '设置 Bark 地址 → 发送六位验证码\\n        ↓\\n验证成功后开启通知类型\\n        ↓\\n任务终态 / 待审批事件\\n        ↓\\n检查用户是否正在查看该员工\\n        ↓\\n去重与队列连跑抑制\\n        ↓\\n发送标题、员工、摘要、图标 URL、深链',
      '通知偏好由实例设置保存，开启前必须完成 OTP 验证。服务层按请求和终态去重，任务队列只在最终收口时通知；图标使用公网可访问的静态资源 URL，深链定位实例、数字员工或审批命令。',
      '- iOS 通知列表的应用小图标由 Bark 客户端决定，远程 icon 参数通常只影响通知内容图标，不能替换 Bark 自身图标。\\n- 用户正在查看对应对话时会抑制重复提醒。\\n- 通知正文不发送完整命令 JSON、凭据或敏感日志。',
    ),
  },
  {
    id: 'observability-unread', categoryId: 'observability', label: '终态未读', description: '最新快照、优先级和已读收口',
    content: manualArticle(
      '终态未读',
      '任务完成或报错后，平台为数字员工保留最新一条终态未读快照。PC、移动端和灵动岛共用这份状态；用户进入对应对话或点击事件后才清除。',
      '任务进入 done / failed\\n        ↓\\n写入 task_unread_kind / at / duration / summary\\n        ↓\\n同类新终态覆盖旧快照\\n        ↓\\nPC、移动端、中继与灵动岛读取\\n        ↓\\n按 error > approval > running > completed 展示\\n        ↓\\n用户打开对应对话 → 标记已读',
      '终态字段保存在数字员工状态并由 bridge 镜像到中继。列表模型使用统一优先级，忙碌状态不会被旧完成未读覆盖；查看动作调用已读接口，随后各端通过事件或补同步收敛。',
      '- 每名数字员工只保留最新一条未读终态，不是完整通知历史。\\n- 已读只清除提醒状态，不删除对话消息、执行结果或审计记录。\\n- 多端同时操作可能短暂显示旧快照，重连后以服务端状态为准。',
    ),
  },
  {
    id: 'observability-ios-island', categoryId: 'observability', label: 'iOS 灵动岛', description: '四态优先级、展开摘要和深链',
    content: manualArticle(
      'iOS 灵动岛',
      'iOS Live Activity 用收缩态图标和展开摘要展示报错、待审批、运行中与已完成四种状态。点击事件会恢复实例登录并跳到对应数字员工对话或具体审批。',
      'App 获取实例事件快照\\n        ↓\\n聚合 error / approval / running / completed\\n        ↓\\n按优先级选择当前展示态\\n        ↓\\nActivityKit start / update\\n        ↓\\n收缩态状态符号 + 展开最多三行摘要\\n        ↓\\n点击深链 → 解锁实例 → 打开员工或命令',
      '移动端将中继事件转换为 ActivityAttributes 和 ContentState，本地使用 ActivityKit 创建与更新 Live Activity。运行态可携带任务规划步骤，终态显示员工、部门、耗时和完成时间；深链包含稳定的实例、员工与审批 ID。',
      '- 当前未接入 APNs Live Activity 远程推送，App 前台和短时后台只能尽力更新；被系统彻底挂起后不保证实时。\\n- 系统决定 Live Activity 的存活时间、刷新频率和具体展示位置。\\n- 深链打开后仍需通过设备会话和实例解锁校验，不能仅凭 URL 越权。',
    ),
  },
  {
    id: 'observability-mac-island', categoryId: 'observability', label: 'macOS 灵动岛', description: '常驻胶囊、任务步骤和跳转',
    content: manualArticle(
      'macOS 灵动岛',
      'macOS 灵动岛是独立的 SwiftUI 常驻胶囊，读取本机 Atolla 事件并展示与移动端一致的四态优先级。收缩态显示状态符号，展开后可查看员工、运行步骤、耗时和错误摘要。',
      '管理台同步 Token 与 API 地址\\n        ↓\\nAtollaIsland 常驻轮询 /api/admin/island/events\\n        ↓\\n聚合最高优先级事件\\n        ↓\\nSwiftUI 胶囊收缩 / 展开动画\\n        ↓\\n点击员工或审批行\\n        ↓\\n打开管理台深链并补拉对应状态',
      'IslandViewModel 读取事件快照，IslandMorphDriver 控制副岛合并和展开动画，IslandRootView 渲染最多可见行。配置保存在本机 island.json；点击后用 agent 和 approval 参数定位管理台，页面会主动补拉 pending 审批。',
      '- macOS 胶囊不是苹果系统 Live Activity，必须安装并保持本机常驻进程运行。\\n- 未签名预编译包首次运行可能受 macOS 安全策略提示。\\n- 岛只展示摘要，完整输出、审批详情和错误上下文仍以管理台对话为准。',
    ),
  },
  {
    id: 'observability-audit-health', categoryId: 'observability', label: '审计与运行健康', description: '提问耗时、工具、主机指标和后台守护',
    content: manualArticle(
      '审计与运行健康',
      'Atolla 将任务耗时、引擎事件、工具调用、权限决定和主机指标组合成运行视图，帮助区分数字员工逻辑问题、引擎问题、电脑资源不足或中继断线。',
      '任务开始记录 started_at\\n        ↓\\nSSE 持续接收文本 / 工具 / 用量 / 规划事件\\n        ↓\\n任务终态记录 duration 与 summary\\n        ↓\\n命令决定写入 command_audits\\n        ↓\\n实例心跳上报 CPU / 内存 / 磁盘 / 版本\\n        ↓\\n健康页与时间线联合排查',
      '任务时间使用服务端时间戳并由前端定时计算显示，终态后固定为持久化耗时。审计表记录工具和风险决定，实例心跳提供简化主机指标；后台守护状态和 health 接口用于确认 Atolla 服务是否持续运行。',
      '- 主机指标用于趋势和快速诊断，不替代专业监控、日志平台与告警系统。\\n- 客户端时区或旧时间格式异常时需规范化，不能把解析失败显示成持续 0 秒。\\n- 健康接口成功只说明服务可响应，不保证外部引擎额度、网络和目标资源全部可用。',
    ),
  },
]
