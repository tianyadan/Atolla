-- v0.5.8 首位管理员账号（密码哈希）。服务启动时也会幂等建表。
USE colleague_avatar;

CREATE TABLE IF NOT EXISTS admin_account (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_username (username)
) ENGINE=InnoDB;
