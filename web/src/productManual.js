/**
 * 产品手册注册表：正文按一级模块拆分，页面继续消费统一的分类和文章数组。
 */
import { platformItems } from './productManualContent/platform.js'
import { employeeItems } from './productManualContent/employees.js'
import { conversationItems } from './productManualContent/conversation.js'
import { safetyItems } from './productManualContent/safety.js'
import { collaborationItems } from './productManualContent/collaboration.js'
import { memoryItems } from './productManualContent/memory.js'
import { skillItems } from './productManualContent/skills.js'
import { remoteItems } from './productManualContent/remote.js'
import { observabilityItems } from './productManualContent/observability.js'

export const PRODUCT_MANUAL_CATEGORIES = [
  { id: 'platform', label: '平台与引擎', description: '启动、引擎和数据库运行基础', itemIds: platformItems.map((item) => item.id) },
  { id: 'employees', label: '数字员工', description: '招聘、组织、权限和生命周期', itemIds: employeeItems.map((item) => item.id) },
  { id: 'conversation', label: '对话与任务', description: '流式对话、队列、附件和任务控制', itemIds: conversationItems.map((item) => item.id) },
  { id: 'safety', label: '安全与审批', description: '权限网关、JEV、人工审批和审计', itemIds: safetyItems.map((item) => item.id) },
  { id: 'collaboration', label: '员工协作', description: '@ 委托与群聊共享时间线', itemIds: collaborationItems.map((item) => item.id) },
  { id: 'memory', label: '记忆与上下文', description: '引擎 Session、压缩与离职记忆', itemIds: memoryItems.map((item) => item.id) },
  { id: 'skills', label: '技能与资源', description: '技能商店、浏览器、数据库和服务器', itemIds: skillItems.map((item) => item.id) },
  { id: 'remote', label: '远程与多端', description: '实例、移动端、镜像同步和远程部署', itemIds: remoteItems.map((item) => item.id) },
  { id: 'observability', label: '通知与可观测', description: 'Bark、灵动岛、未读与运行健康', itemIds: observabilityItems.map((item) => item.id) },
]

export const PRODUCT_MANUAL_ITEMS = [
  ...platformItems,
  ...employeeItems,
  ...conversationItems,
  ...safetyItems,
  ...collaborationItems,
  ...memoryItems,
  ...skillItems,
  ...remoteItems,
  ...observabilityItems,
]
