package store

import (
	"strings"
	"testing"
)

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

// TestToSQLiteDDLPreservesKeySuffixColumns 防止 KEY 索引正则误吃 source_key / idempotency_key 列定义。
func TestToSQLiteDDLPreservesKeySuffixColumns(t *testing.T) {
	ddl := `
		CREATE TABLE IF NOT EXISTS task_dispatches (
		  id                         BIGINT NOT NULL AUTO_INCREMENT,
		  source_key                 VARCHAR(512) NOT NULL,
		  idempotency_key            CHAR(64) NOT NULL,
		  status                     VARCHAR(32) NOT NULL,
		  PRIMARY KEY (id),
		  UNIQUE KEY uq_task_dispatch_idempotency (idempotency_key),
		  KEY idx_task_dispatch_status (status)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	out := toSQLiteDDL(ddl)
	for _, want := range []string{"source_key", "idempotency_key", "UNIQUE(idempotency_key)"} {
		if !strings.Contains(out, want) {
			t.Fatalf("converted DDL missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "KEY idx_task_dispatch_status") {
		t.Fatalf("plain KEY index should be stripped:\n%s", out)
	}
}
