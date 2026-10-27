# 数据库设置 / 引导选库 / 一键迁库

## 背景

平台主库已支持 `sqlite`（默认）与 `mysql`（Docker）双驱动，但驱动只能靠环境变量切换，设置页无入口，引导只扫 CLI，库间无产品化迁数。

## 目标

1. 首次引导：先 CLI，再数据库；默认 SQLite，可改 MySQL（本机 Docker 一键）。
2. 设置页新增「数据库」：两张带 logo 的卡片二选一。
3. 切换时支持一键迁移（双向）；目标库先清空再导入；强风险确认。
4. 写 `.env` 后尽力自动重启；失败则提示手动 `./scripts/restart.sh`。

## 非目标（首期）

- 自定义远程 MySQL DSN / 高级连接表单
- 合并迁库、冲突策略可配
- 迁库历史回滚、增量同步
- MySQL ↔ SQLite 以外的引擎

## 决策摘要

| 项 | 选择 |
| --- | --- |
| MySQL 连接 | A：本机 Docker compose，默认 `3307` / `root:root` / `colleague_avatar` |
| 重启 | A+B：优先自动重启，失败给手动命令 |
| 目标已有数据 | A：清空后导入，二次确认 + 勾选知悉风险 |
| 实现路径 | ① 配置落 `.env` + 表级拷贝 + 尽力自重启 |

## 架构

```
[EngineOnboarding]  CLI scan → db phase → POST /api/setup/db-choose → .env
[Settings DB fold]  GET status → Modal → POST /api/admin/db/switch
                         ├─ (optional) table copy source → target
                         ├─ write .env
                         └─ async restart → poll /health | show manual cmd
[store migrate]     同时开源/目标 DB；目标 Migrate schema；按表白名单拷贝
```

配置真相源：仓库根 `.env` 的 `AVATAR_DB_DRIVER` / `AVATAR_DB_DSN`（与 `scripts/start.sh`、`config.Load()` 一致）。

## 引导流程

1. 现有 `scan` / `install`（CLI）不变。
2. CLI 就绪后进入 phase `db`（不可跳过到登录前未选库；默认选中 SQLite）。
3. 卡片：SQLite / MySQL + 小 SVG logo + 短说明。
4. 选 MySQL：检测 Docker；`docker compose up -d mysql`；ping 就绪；失败则提示或改回 SQLite。
5. 「继续」→ `POST /api/setup/db-choose` → 写 `.env` → `onReady`（进登录/注册）。

首次引导写库接口与引擎 setup 同级（允许未注册管理员调用）。

## 设置页 UI

- 新 `SettingsFold`「数据库」，靠近「工作引擎」。
- 展示当前驱动；两张选择卡（与引导同视觉语言）。
- 切到另一驱动 → Modal：
  - 风险：将清空目标库全部 Atolla 数据后从源覆盖，不可撤销。
  - 勾选「我了解风险」后才可点「迁移并切换」。
  - 「仅切换空库」：不拷贝，只改驱动（目标为空或接受空白）。
  - 「取消」。
- 迁移中：表名 + 百分比；完成后「正在重启…」；health 超时展示手动命令 + 复制。

## API

| 方法 | 路径 | 鉴权 | 作用 |
| --- | --- | --- | --- |
| GET | `/api/setup/db-status` | 公开（setup） | 当前驱动、SQLite 可写、Docker/MySQL 可达 |
| POST | `/api/setup/db-choose` | 公开（setup） | body `{driver}`；起 MySQL（若需要）；写 `.env` |
| GET | `/api/admin/db/status` | 管理员 | 当前驱动、两侧是否有数据、迁移任务状态 |
| POST | `/api/admin/db/switch` | 管理员 | body `{driver, migrate: bool}`；迁库可选；写 `.env`；触发重启 |
| GET | `/api/admin/db/migrate-progress` | 管理员 | `phase` / `table` / `percent` / `error` / `restart` |

### `switch` 行为

1. `migrate=true`：源=当前运行库，目标=另一驱动默认 DSN；目标 schema Migrate → 清空业务表 → 批量插入。
2. 迁库失败：**不**改 `.env`、不重启；返回 error，可重试。
3. 成功：更新 `.env` → 异步重启 → 响应 `{restart:"pending"|"manual", command}`。
4. `migrate=false`：只写 `.env` 并重启（用于空库或接受丢弃当前库视图）。

### 重启

- 优先执行仓库 `scripts/restart.sh`（或等价 shutdown+start）；有 watchdog 时由其拉起亦可。
- 前端轮询 `GET /health`；超时则展示手动命令。

## 迁库引擎

- 固定表白名单：平台 schema 内表（与 `Migrate` / `schema.sqlite.sql` 对齐），按依赖顺序（无 FK 或先父后子；SQLite 可暂关外键）。
- 每表：清空目标 → `SELECT *` 源流式/分批 → `INSERT`。
- 类型：复用 dialect（JSON 文本、DATETIME/`_texttotime`）。
- 进度：内存任务状态供 progress API 读取（单实例足够；SQLite 单写者场景）。
- 不做跨机；MySQL 仅本机默认 Docker DSN。

## 默认 DSN

| 驱动 | DSN |
| --- | --- |
| sqlite | 写入 `.env` 时用**仓库根绝对路径** `…/colleague-avatar/data/atolla.db`（避免 `server/` cwd 相对路径漂移） |
| mysql | `root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local` |

`migrate=false`：只改驱动并重启；旧库文件/容器数据保留但不挂载，新进程连目标默认库（通常为空）。不在此时清空源库。

## 错误与安全

- 管理员接口需登录；setup 写接口仅用于未完成引导的本机场景（与现有 setup 同等信任边界）。
- 风险文案必须在 migrate 路径展示并勾选。
- Docker 不可用时不得静默成功选 MySQL。
- 写 `.env` 时只改/追加 DB 相关键，保留其它密钥。

## 测试要点

- setup：默认 SQLite 落盘；MySQL 无 Docker 失败；有 Docker 可 ping。
- 迁库：SQLite→MySQL、MySQL→SQLite 往返后关键表行数一致（managed_agents / messages 抽样）。
- 迁库失败不改 `.env`。
- switch 后进程能以新驱动健康响应（或 manual 路径文案正确）。

## 前端文件（预期）

- 扩展 `web/src/EngineOnboarding.jsx`（phase `db`）
- 新增 `web/src/DbSettings.jsx`、`web/src/dbLogos.jsx`（或等价）
- `App.jsx` 设置区挂 Fold

## 后端文件（预期）

- `handler`：setup/admin db 路由
- `internal/dbswitch` 或 `store` 旁：迁库 + `.env` 读写 + docker/restart 编排
- 复用 `store.NewWithDriver` / `Migrate`
