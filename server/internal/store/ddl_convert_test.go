package store

import "testing"

func TestToSQLiteDDLSessionPerm(t *testing.T) {
	ddl := `
		CREATE TABLE IF NOT EXISTS session_permissions (
		  id                 BIGINT        NOT NULL AUTO_INCREMENT,
		  conversation_id    BIGINT        NOT NULL,
		  action_type        VARCHAR(64)   NOT NULL,
		  command_signature  VARCHAR(768)  NOT NULL,
		  working_dir        VARCHAR(1024) NOT NULL DEFAULT '',
		  environment        VARCHAR(128)  NOT NULL DEFAULT '',
		  resource_scope     VARCHAR(1024) NOT NULL DEFAULT '',
		  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  KEY idx_conv_sig (conversation_id, command_signature(191)),
		  CONSTRAINT fk_sp_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
		) ENGINE=InnoDB`
	out := toSQLiteDDL(ddl)
	t.Logf("OUT:\n%s", out)
}
