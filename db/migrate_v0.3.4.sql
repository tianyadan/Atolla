-- v0.3.4 前台助理 + 访客登记（启动时 ensureMigrate 也会幂等补齐）
USE colleague_avatar;

-- 若列已存在会报错，可忽略；新库用 schema.sql
ALTER TABLE managed_agents ADD COLUMN is_receptionist TINYINT NOT NULL DEFAULT 0 AFTER status;
ALTER TABLE conversations ADD COLUMN visitor_id BIGINT NULL AFTER agent_id;

CREATE TABLE IF NOT EXISTS visitors (
  id                      BIGINT       NOT NULL AUTO_INCREMENT,
  public_id               VARCHAR(64)  NOT NULL,
  name                    VARCHAR(64)  NOT NULL,
  current_conversation_id BIGINT       NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_visitor_public (public_id),
  KEY idx_visitor_seen (last_seen_at)
) ENGINE=InnoDB;
