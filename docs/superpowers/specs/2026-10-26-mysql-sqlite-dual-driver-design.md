# MySQL + SQLite 双驱动（平台主库）

## 目标
- 默认 SQLite：`./data/atolla.db`，免 Docker
- 可选 MySQL：保留现有 DSN / compose
- 业务 SQL 尽量共用；方言差集中在 store

## 配置
- `AVATAR_DB_DRIVER=sqlite|mysql`（默认 `sqlite`）
- `AVATAR_DB_DSN`：sqlite 为文件路径；mysql 为原 DSN

## 实现要点
1. `store.NewWithDriver(driver, dsn)`；sqlite 开 WAL + busy_timeout
2. SQLite 注册兼容标量：`NOW` / `UNIX_TIMESTAMP` / `LEFT` / `IF`
3. `hasColumn` / `hasTable` 抽象；Migrate 与 Ensure* 共用
4. DDL：`execDDL` 将 MySQL CREATE 机械降级为 SQLite；时间列保留 `DATETIME` 声明
5. DSN：`_texttotime=1&_time_format=sqlite`，TEXT/DATETIME 扫入 `time.Time`
6. `ON DUPLICATE KEY` → `insertOnConflictUpdate` / `insertOnConflictDoNothing`
7. JSON 写入：`jsonParam()`（MySQL `CAST(? AS JSON)`，SQLite 纯 `?`）
8. 空库 bootstrap：执行 `schema.sqlite.sql`
9. `scripts/start.sh` 默认 sqlite；`--mysql` 启 docker

## 非目标（首期）
- MySQL ↔ SQLite 自动迁库
- 多进程共写同一 sqlite 文件
