-- Atolla SQLite schema (auto-generated)
PRAGMA foreign_keys = ON;

-- colleague_avatar schema v0.0.3
-- MySQL 8 (本地 docker,端口 3307)
-- v0.0.3: 引入会话模型 conversations + messages;废弃 questions 表。

-- 授权工作区 allowlist
CREATE TABLE IF NOT EXISTS authorized_workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name       VARCHAR(255)  NOT NULL UNIQUE,
  path       VARCHAR(1024) NOT NULL,
  type       VARCHAR(16)    NOT NULL DEFAULT 'code',  -- code / db
  enabled    INTEGER       NOT NULL DEFAULT 1,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(path)
);

-- 分身配置(预留人设/语气等,key-value)
CREATE TABLE IF NOT EXISTS agent_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key VARCHAR(128) NOT NULL UNIQUE,
  config_value TEXT         NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP);

-- 会话(按 user_ip 分组;管理型智能体可挂 agent_id)
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_ip     VARCHAR(64)   NOT NULL,
  mode       VARCHAR(16)    NOT NULL DEFAULT 'single',  -- single / chat
  agent_id   INTEGER        NULL,
  visitor_id INTEGER        NULL,
  engine_session_id     VARCHAR(512) NULL,
  engine_used_tokens    INTEGER NOT NULL DEFAULT 0,
  engine_window_tokens  INTEGER NOT NULL DEFAULT 0,
  engine_total_tokens   INTEGER NOT NULL DEFAULT 0,
  engine_context_source VARCHAR(64) NOT NULL DEFAULT '',
  engine_context_updated_at DATETIME NULL,
  needs_system_reinject INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v0.1.3: 管理台智能体注册表
CREATE TABLE IF NOT EXISTS agent_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name       VARCHAR(128) NOT NULL,
  sort_order INTEGER          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS managed_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name            VARCHAR(128)   NOT NULL,
  avatar_url      VARCHAR(512)   NULL,
  jelly_color     VARCHAR(16)    NOT NULL DEFAULT '', -- orange|yellow|blue|green|purple|red|cyan|teal|pink|lime|coral|sky
  folder_id       INTEGER         NULL,
  job_role        VARCHAR(64)    NOT NULL DEFAULT '', -- 调度岗位（单选）
  engine          VARCHAR(32)    NOT NULL,           -- claude | codex | agent
  context_window_tokens INTEGER NOT NULL DEFAULT 1000000, -- display denominator only
  bin_path        VARCHAR(512)   NOT NULL DEFAULT '',
  rules_prompt    TEXT       NULL,
  auto_review     INTEGER        NOT NULL DEFAULT 0,
  auto_approve_all INTEGER       NOT NULL DEFAULT 0, -- 命令全部审批通过
  task_plan_enabled INTEGER      NOT NULL DEFAULT 1,
  allow_write     INTEGER        NOT NULL DEFAULT 1,
  allow_network   INTEGER        NOT NULL DEFAULT 1,
  allow_rm        INTEGER        NOT NULL DEFAULT 0,
  allow_browser   INTEGER        NOT NULL DEFAULT 0,
  workspace_path  VARCHAR(1024)  NOT NULL DEFAULT '',
  schedule_enabled INTEGER       NOT NULL DEFAULT 0,
  schedule_cron   VARCHAR(128)   NOT NULL DEFAULT '',
  schedule_label  VARCHAR(128)   NOT NULL DEFAULT '',
  status          VARCHAR(32)    NOT NULL DEFAULT 'idle', -- idle|running|waiting|error
  is_receptionist INTEGER        NOT NULL DEFAULT 0,
  conversation_id INTEGER         NULL,
  cloned_from_id  INTEGER         NULL,
  last_error      TEXT           NULL,
  last_run_ms     INTEGER            NULL,
  task_unread     INTEGER        NOT NULL DEFAULT 0,
  task_unread_kind VARCHAR(16)    NOT NULL DEFAULT '', -- completed|error
  task_unread_at DATETIME       NULL,
  task_unread_duration_ms INTEGER     NULL,
  task_unread_summary TEXT        NULL,
  run_started_at DATETIME       NULL,
  created_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 消息
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER         NOT NULL,
  role           VARCHAR(16)     NOT NULL,            -- user / assistant / invoke_quote / invoke_divider
  content        TEXT        NULL,
  status         VARCHAR(20)      NOT NULL DEFAULT 'ok', -- ok / rejected / error
  workspace_path VARCHAR(1024)   NULL,
  reply_ms       INTEGER             NULL,
  exclude_from_context INTEGER   NOT NULL DEFAULT 0,
  meta_json      TEXT            NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 多 Agent 统一管理中心: 各 agent(可插拔,agent_type 区分)上报任务进度
CREATE TABLE IF NOT EXISTS agent_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type  VARCHAR(64)    NOT NULL,   -- codex / cursor / claude / ...
  agent_id    VARCHAR(128)   DEFAULT '',
  task_id     VARCHAR(128)   NOT NULL,   -- agent 侧任务ID(与 agent_type 组成幂等键)
  task_name   VARCHAR(512)   DEFAULT '',
  status     VARCHAR(32)    NOT NULL,   -- running / done / failed / waiting
  progress  INTEGER            DEFAULT 0,    -- 0-100
  message   TEXT            NULL,         -- 进度说明/汇报
  payload   TEXT            NULL,         -- 附加结构化信息(可插拔扩展)
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_type, task_id)
);

-- v0.1.8: 命令审批审计
CREATE TABLE IF NOT EXISTS command_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER        NOT NULL DEFAULT 0,
  agent_id        INTEGER        NOT NULL DEFAULT 0,
  tool_name       VARCHAR(64)   NOT NULL DEFAULT '',
  command_text    TEXT          NOT NULL,
  decision        VARCHAR(16)   NOT NULL,
  decided_by      VARCHAR(32)   NOT NULL,
  engine          VARCHAR(32)   NOT NULL DEFAULT '',
  action_type     VARCHAR(64)   NOT NULL DEFAULT '',
  environment     VARCHAR(128)  NOT NULL DEFAULT '',
  risk_score      DOUBLE        NOT NULL DEFAULT 0,
  risk            VARCHAR(16)   DEFAULT '',
  meaning         TEXT          NULL,
  note            TEXT          NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id    INTEGER        NOT NULL,
  action_type        VARCHAR(64)   NOT NULL,
  command_signature  VARCHAR(768)  NOT NULL,
  working_dir        VARCHAR(1024) NOT NULL DEFAULT '',
  environment        VARCHAR(128)  NOT NULL DEFAULT '',
  resource_scope     VARCHAR(1024) NOT NULL DEFAULT '',
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 种子: 授权工作区(code 类型 + 数据查询 db 项目)


-- 种子: 人设(田浩文的赛博助理)


-- v0.1.1: 测试服务器治理
CREATE TABLE IF NOT EXISTS test_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name          VARCHAR(128)  NOT NULL DEFAULT '',
  host          VARCHAR(255)  NOT NULL,
  port          INTEGER           NOT NULL DEFAULT 22,
  username      VARCHAR(128)  NOT NULL,
  password_enc  TEXT          NOT NULL,
  enabled       INTEGER       NOT NULL DEFAULT 1,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(host, username)
);

CREATE TABLE IF NOT EXISTS test_server_allowed_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         VARCHAR(64)  NOT NULL,
  note       VARCHAR(255) DEFAULT '',
  enabled    INTEGER      NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ip)
);



-- 网络域名白名单（同步到本机 Cursor/Claude/Codex 沙箱）
CREATE TABLE IF NOT EXISTS network_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern    VARCHAR(255) NOT NULL,
  source     VARCHAR(32)  NOT NULL DEFAULT 'admin',
  agent_id   INTEGER       NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pattern)
);



-- v0.2.7: 团队编排 / 占用 / 长期记忆
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name         VARCHAR(255)  NOT NULL,
  description  TEXT          NULL,
  graph_json   TEXT          NOT NULL,
  version      INTEGER           NOT NULL DEFAULT 1,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v0.2.23: 项目 × 数字员工持久协作会话
CREATE TABLE IF NOT EXISTS workflow_agent_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id   INTEGER   NOT NULL,
  agent_id        INTEGER   NOT NULL,
  conversation_id INTEGER   NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_id, agent_id)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id        INTEGER        NOT NULL,
  status               VARCHAR(32)   NOT NULL DEFAULT 'pending',
  input_prompt         TEXT      NULL,
  current_node_ids_json TEXT         NULL,
  parallel_state_json  TEXT          NULL,
  fail_node_id         VARCHAR(64)   NOT NULL DEFAULT '',
  fail_reason          TEXT          NULL,
  progress_json        TEXT          NULL,
  resume_cursor_json   TEXT          NULL,
  started_at DATETIME      NULL,
  finished_at DATETIME      NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS node_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            INTEGER        NOT NULL,
  node_id           VARCHAR(64)   NOT NULL,
  attempt           INTEGER           NOT NULL DEFAULT 1,
  node_type         VARCHAR(32)   NOT NULL,
  agent_id          INTEGER        NOT NULL DEFAULT 0,
  status            VARCHAR(32)   NOT NULL DEFAULT 'pending',
  conversation_id   INTEGER        NOT NULL DEFAULT 0,
  input_json        TEXT          NULL,
  output_json       TEXT          NULL,
  events_json       TEXT          NULL,
  error_text        TEXT          NULL,
  parent_attempt_id INTEGER        NULL,
  started_at DATETIME      NULL,
  finished_at DATETIME      NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_occupancy (
  agent_id            INTEGER        NOT NULL,
  source_type         VARCHAR(32)   NOT NULL,
  source_id           VARCHAR(128)  NOT NULL DEFAULT '',
  source_name         VARCHAR(255)  NOT NULL DEFAULT '',
  workflow_run_id     INTEGER        NOT NULL DEFAULT 0,
  node_execution_id   INTEGER        NOT NULL DEFAULT 0,
  task_name           VARCHAR(512)  NOT NULL DEFAULT '',
  started_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id));

CREATE TABLE IF NOT EXISTS agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       INTEGER        NOT NULL,
  source_type    VARCHAR(32)   NOT NULL DEFAULT '',
  source_id      VARCHAR(128)  NOT NULL DEFAULT '',
  workflow_id    INTEGER        NOT NULL DEFAULT 0,
  workspace      VARCHAR(1024) NOT NULL DEFAULT '',
  title          VARCHAR(512)  NOT NULL DEFAULT '',
  summary        TEXT          NOT NULL,
  metadata_json  TEXT          NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v0.3.4 前台访客
CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id               VARCHAR(64)  NOT NULL,
  name                    VARCHAR(64)  NOT NULL,
  current_conversation_id INTEGER       NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(public_id)
);

-- v0.4.0 技能商店目录 + 按数字人安装
CREATE TABLE IF NOT EXISTS skill_catalog (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  summary VARCHAR(512) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  icon_key VARCHAR(64) NOT NULL DEFAULT 'custom',
  icon_url VARCHAR(1024) NULL,
  source TEXT NOT NULL DEFAULT 'builtin',
  publisher_id VARCHAR(64) NULL,
  publisher_name VARCHAR(128) NULL,
  author VARCHAR(128) NOT NULL DEFAULT 'Atolla',
  category VARCHAR(64) NOT NULL DEFAULT 'general',
  risk VARCHAR(16) NOT NULL DEFAULT 'mid',
  rules_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  enabled INTEGER(1) NOT NULL DEFAULT 1,
  install_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS agent_skill_installs (
  agent_id INTEGER NOT NULL,
  skill_id VARCHAR(64) NOT NULL,
  enabled INTEGER(1) NOT NULL DEFAULT 1,
  enabled_capabilities_json TEXT NOT NULL,
  config_json TEXT NULL,
  installed_by VARCHAR(64) NULL,
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, skill_id));

-- v0.4.1 数据库技能多数据源（密码 AES 密文）
CREATE TABLE IF NOT EXISTS agent_db_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  name VARCHAR(64) NOT NULL,
  db_type VARCHAR(16) NOT NULL,
  url VARCHAR(512) NOT NULL,
  database_name VARCHAR(128) NOT NULL DEFAULT '',
  username VARCHAR(128) NOT NULL DEFAULT '',
  password_enc TEXT NULL,
  perm_list INTEGER(1) NOT NULL DEFAULT 1,
  perm_read INTEGER(1) NOT NULL DEFAULT 1,
  perm_create INTEGER(1) NOT NULL DEFAULT 0,
  perm_update INTEGER(1) NOT NULL DEFAULT 0,
  perm_delete INTEGER(1) NOT NULL DEFAULT 0,
  enabled INTEGER(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v0.4.3 服务器控制技能多服务器（SSH，密码 AES 密文）
CREATE TABLE IF NOT EXISTS agent_server_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  name VARCHAR(64) NOT NULL,
  host VARCHAR(512) NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username VARCHAR(128) NOT NULL DEFAULT '',
  password_enc TEXT NULL,
  allow_delete INTEGER(1) NOT NULL DEFAULT 0,
  allow_docker_restart INTEGER(1) NOT NULL DEFAULT 0,
  enabled INTEGER(1) NOT NULL DEFAULT 1,
  reachable INTEGER(1) NOT NULL DEFAULT 0,
  last_test_at DATETIME NULL,
  last_test_error VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v0.4.5: 命令全部审批通过的审计（保留约 7 天，定时清理）
CREATE TABLE IF NOT EXISTS auto_approve_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL DEFAULT 0,
  conversation_id INTEGER NOT NULL DEFAULT 0,
  tool_name VARCHAR(64) NOT NULL DEFAULT '',
  command_text TEXT NOT NULL,
  reason VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v0.4.7: 解聘离职记忆书（仅 AI 生成，可认领挂载）
CREATE TABLE IF NOT EXISTS legacy_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_agent_id INTEGER NOT NULL DEFAULT 0,
  agent_name VARCHAR(128) NOT NULL DEFAULT '',
  job_title VARCHAR(128) NOT NULL DEFAULT '数字员工',
  avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  engine VARCHAR(32) NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  materials_json TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'generating',
  error_message VARCHAR(512) NOT NULL DEFAULT '',
  claimed_by_agent_id INTEGER NULL,
  claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_legacy_memory_mounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  legacy_memory_id INTEGER NOT NULL,
  source_agent_name VARCHAR(128) NOT NULL DEFAULT '',
  source_job_title VARCHAR(128) NOT NULL DEFAULT '',
  source_avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  mounted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(legacy_memory_id)
);

-- 规则调度建议：每个来源修订一条记录，精确重复由 idempotency_key 拦截。
CREATE TABLE IF NOT EXISTS task_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type VARCHAR(32) NOT NULL,
  source_key VARCHAR(512) NOT NULL,
  source_key_hash CHAR(64) NOT NULL,
  source_revision VARCHAR(128) NOT NULL,
  event_action VARCHAR(32) NOT NULL,
  delivery_id VARCHAR(128) NOT NULL DEFAULT '',
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  parent_dispatch_id INTEGER NULL,
  superseded_by_id INTEGER NULL,
  source_url VARCHAR(1024) NOT NULL DEFAULT '',
  task_title VARCHAR(512) NOT NULL DEFAULT '',
  task_body TEXT NULL,
  task_type VARCHAR(64) NOT NULL DEFAULT '',
  required_role VARCHAR(64) NOT NULL DEFAULT '',
  required_capabilities_json TEXT NOT NULL,
  optional_tags_json TEXT NOT NULL,
  required_permissions_json TEXT NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  deadline_at DATETIME NULL,
  status VARCHAR(32) NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1,
  recommended_agent_id INTEGER NULL,
  assigned_agent_id INTEGER NULL,
  queue_task_id INTEGER NULL,
  candidates_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  llm_used INTEGER NOT NULL DEFAULT 0,
  requires_review INTEGER NOT NULL DEFAULT 1,
  confirmed_by VARCHAR(128) NOT NULL DEFAULT '',
  status_reason VARCHAR(512) NOT NULL DEFAULT '',
  last_error TEXT NULL,
  classified_at DATETIME NULL,
  recommended_at DATETIME NULL,
  confirmed_at DATETIME NULL,
  queued_at DATETIME NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_dispatch_source ON task_dispatches (source_type, source_key_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_task_dispatch_status ON task_dispatches (status, created_at);
CREATE INDEX IF NOT EXISTS idx_task_dispatch_agent ON task_dispatches (assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_task_dispatch_parent ON task_dispatches (parent_dispatch_id);
