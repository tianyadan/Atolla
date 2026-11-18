import { manualArticle } from './article.js'

export const memoryItems = [
  {
    id: 'memory-session', categoryId: 'memory', label: '会话记忆', description: '平台消息与引擎 Session 双层存储',
    content: manualArticle(
      '会话记忆',
      'Atolla 将可见消息和引擎原生上下文分开保存。数据库负责恢复时间线、工具状态和审计记录，engine_session_id 让 Claude、Codex 或 Cursor 在后续提问时继续自己的原生上下文。',
      '用户发送消息\\n        ↓\\nmessages 保存用户内容与附件\\n        ↓\\n携带 engine_session_id 调用工作引擎\\n        ↓\\n引擎原生 Session 继续上下文\\n        ↓\\n流式事件写回 messages / 工具记录\\n        ↓\\n下次打开恢复时间线并继续 Session',
      'conversation 关联数字员工和当前引擎 Session，消息表保存可重放的用户、助手、工具和命令事件。服务层在引擎返回新 Session ID 后持久化绑定；恢复时先加载平台历史，再用原生 Session 继续执行。',
      '- 数据库历史是界面恢复来源，但不等于完整复制了引擎内部上下文。\\n- 更换工作引擎不能直接复用另一种引擎的 Session ID。\\n- 实例、数字员工和 conversation 必须同时匹配，不能跨实例误用会话。',
    ),
  },
  {
    id: 'memory-compaction', categoryId: 'memory', label: '上下文压缩', description: '原生 Compact、历史裁剪和规则重注入',
    content: manualArticle(
      '上下文压缩',
      '当上下文接近引擎窗口上限时，Atolla 优先调用引擎原生 Compact，在保留当前 Session 的前提下压缩内部记忆，同时收缩平台侧冗长历史并重新注入必要规则。',
      '上下文用量接近阈值\\n        ↓\\n用户手动压缩或平台触发\\n        ↓\\nClaude / Codex / Cursor 原生 compact\\n        ↓\\n收到 context_compacted 事件\\n        ↓\\n保留 Session，重置用量估算\\n        ↓\\n裁剪平台冗余消息并继续对话',
      '各引擎适配器实现自己的 compact 调用，服务端在成功事件后更新 conversation 用量和持久化历史。前端运行中不会因压缩事件拆毁正在生成的流式气泡；后续请求会重新附加系统规则、员工策略和挂载记忆摘要。',
      '- 压缩是有损摘要，不保证逐字保留所有早期细节，关键事实应写入任务或文件。\\n- 原生 compact 失败时不会假装成功，也不会直接清空现有 Session。\\n- 平台历史裁剪和引擎内部压缩是两件事，必须在成功边界内分别更新。',
    ),
  },
  {
    id: 'memory-legacy', categoryId: 'memory', label: '离职记忆与继承', description: '记忆书架、认领和挂载',
    content: manualArticle(
      '离职记忆与继承',
      '解聘数字员工时，用户可以将其重要经验整理为只读记忆书。记忆书进入公共书架后，可由另一名数字员工认领并挂载，在不恢复原员工身份和权限的情况下继承可复用知识。',
      '发起解聘\\n        ↓\\n生成离职记忆 Markdown\\n        ↓\\ngenerating → ready / failed\\n        ↓\\n记忆书架查看、编辑或重试\\n        ↓\\n选择新员工认领\\n        ↓\\nclaimed + 创建只读挂载\\n        ↓\\n后续任务注入精简记忆摘要',
      'legacy_memories 保存来源员工、正文和生成状态，agent_legacy_memory_mounts 保证一份记忆只被一个员工认领。认领操作以事务更新状态并创建挂载；员工设置页和移动端只读展示挂载内容，执行时由服务层生成紧凑提示块。',
      '- 认领记忆不会恢复来源员工的 Session、工作区文件、技能或权限。\\n- 挂载内容是只读参考，事实可能随时间失效，需要新员工自行验证。\\n- 生成失败的记忆必须显式重试；解聘动作不应以伪造的空记忆冒充成功。',
    ),
  },
  {
    id: 'memory-boundaries', categoryId: 'memory', label: '记忆边界', description: '隔离、回退范围和数据生命周期',
    content: manualArticle(
      '记忆边界',
      '记忆必须沿实例、数字员工和会话三层隔离。平台只向当前执行注入明确关联的历史、规则和挂载内容，并为消息、审计、终态通知及离职记忆分别管理生命周期。',
      '实例 ID\\n  ↓ 校验\\n数字员工 ID\\n  ↓ 校验\\nconversation ID + engine_session_id\\n  ↓\\n加载当前消息 / 权限 / 挂载记忆\\n  ↓\\n构造本轮上下文\\n  ↓\\n完成后分别持久化对应数据',
      'API 和 store 查询使用实体 ID 组合约束，不以显示名称推断归属。会话恢复先检查实例在线和员工可用，再读取该员工最近 conversation；找不到原对象时返回明确引导，不静默切换。审计、通知和记忆书使用独立表与状态。',
      '- 数字员工之间默认不共享完整历史，群聊和显式挂载也只开放各自约定的数据。\\n- 删除、解聘或迁移实体前必须确认相关数据的保留策略，不能假设所有记录同步消失。\\n- 回退到数据库消息可恢复可见时间线，但无法重建已经丢失的引擎原生 Session。',
    ),
  },
]
