# 数字员工解聘记忆（Legacy Memory）设计

日期：2026-10-13  
状态：已确认（方案 A）

## 目标

解聘时可勾选保留「离职记忆书」；异步 AI 生成；书架管理；认领后一次性写入员工规则区；每位最多挂载 5 本；禁止人工新建。

## 记忆章节（默认全选）

profile / projects / credentials（仅线索无明文） / database / servers / docs / habits / open_items / skills

## 流程

1. 解聘弹窗 → 是否保留 + 章节多选  
2. 后端快照素材 → 插入 `legacy_memories(generating)` → 立即删员工 → 异步总结 → `ready`/`failed`  
3. 书架可编辑；认领写入 `rules_prompt` + `agent_legacy_memory_mounts`，书标 `claimed` 下架  
4. 设置页「继承记忆」只读展示来源头像/姓名/岗位  

## 约束

- 每本书全局认领一次  
- 每员工最多 5 本  
- 不落明文密码  
