-- v0.5.11 灵动岛终态未读快照
-- 服务启动时 EnsureTaskUnreadSchema 也会逐列幂等补齐并回填。
USE colleague_avatar;

ALTER TABLE managed_agents
  ADD COLUMN task_unread_kind VARCHAR(16) NOT NULL DEFAULT '' AFTER task_unread,
  ADD COLUMN task_unread_at DATETIME NULL AFTER task_unread_kind,
  ADD COLUMN task_unread_duration_ms INT NULL AFTER task_unread_at,
  ADD COLUMN task_unread_summary TEXT NULL AFTER task_unread_duration_ms;

UPDATE managed_agents
SET task_unread_kind = IF(status='error','error','completed'),
    task_unread_at = updated_at,
    task_unread_duration_ms = last_run_ms,
    task_unread_summary = IF(status='error',last_error,'')
WHERE task_unread=1 AND IFNULL(task_unread_kind,'')='';
