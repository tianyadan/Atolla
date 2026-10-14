# remote-relay 管理台一键部署/升级（SSE 进度）

日期：2026-10-14  
状态：已确认（A + SSH 密钥）

## API

- `POST /api/admin/remote-relay/deploy` → `{ job_id }`
- `POST /api/admin/remote-relay/upgrade` → `{ job_id }`
- `GET /api/admin/remote-relay/deploy-job/:id/stream` → SSE：`log` / `done` / `error`

SSH：`BatchMode=yes`，仅密钥；全局单任务。

## UI

一键部署 / 一键升级按钮 + 实时日志面板；保留复制命令。
