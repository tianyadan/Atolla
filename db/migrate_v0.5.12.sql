-- v0.5.12 长期 Token 用量审计
-- 调用明细仍按 7 天清理；本表不保存提示词/回复，仅保留按 Ask 的 Token 数和引擎快照。

USE colleague_avatar;

ALTER TABLE agent_ask_logs
  ADD COLUMN engine VARCHAR(32) NOT NULL DEFAULT 'unknown' AFTER source;

CREATE TABLE IF NOT EXISTS agent_token_usage_records (
  ask_log_id     BIGINT       NOT NULL,
  usage_date     DATE         NOT NULL,
  engine         VARCHAR(32)  NOT NULL DEFAULT 'unknown',
  input_tokens   BIGINT       NOT NULL DEFAULT 0,
  output_tokens  BIGINT       NOT NULL DEFAULT 0,
  cache_tokens   BIGINT       NOT NULL DEFAULT 0,
  total_tokens   BIGINT       NOT NULL DEFAULT 0,
  estimated      TINYINT      NOT NULL DEFAULT 0,
  recorded_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ask_log_id),
  KEY idx_atur_date_engine (usage_date, engine)
) ENGINE=InnoDB;

-- 老记录在产生时没有引擎快照，按当前员工配置补齐并标记 estimated=1。
INSERT IGNORE INTO agent_token_usage_records
  (ask_log_id, usage_date, engine, input_tokens, output_tokens, cache_tokens, total_tokens, estimated, recorded_at)
SELECT l.id, DATE(l.started_at),
  CASE LOWER(TRIM(COALESCE(NULLIF(NULLIF(l.engine,''),'unknown'), NULLIF(a.engine,''), 'unknown')))
    WHEN 'agent' THEN 'cursor' WHEN 'codex' THEN 'codex' WHEN 'claude' THEN 'claude' WHEN 'cursor' THEN 'cursor' ELSE 'unknown' END,
  l.input_tokens, l.output_tokens, 0, l.total_tokens, 1, NOW()
FROM agent_ask_logs l
LEFT JOIN managed_agents a ON a.id=l.agent_id
WHERE l.status <> 'processing';
