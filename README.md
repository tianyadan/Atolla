# Atolla

[English](README_EN.md)

在你自己的电脑上跑一队数字员工。员工背后是本机的 Claude、Codex 或 Cursor Agent，在授权过的工作区里干活，危险操作先问你再执行。

当前版本 **v0.6.2**。

**v0.6.2 新特性：**
- **Agent 运行明细**：发送任务后实时展示本轮请求耗时、模型调用轨迹、工具执行明细、Token 消耗与生成速度，支持展开查看上下文占比。
- **模型调用轨迹可追溯**：后端记录 CLI 可观测边界内的输入/输出、缓存 Token、上下文窗口用量，任务结束后仍可回看（保留 7 天）。
- **刷新后恢复运行明细**：当前会话丢失时，前端自动从服务端拉取最近一轮运行记录，无缝展示。
- **远程中继页面重构**：服务器部署、远程连接、验证码登录拆成独立区块按依赖顺序展示；部署日志只在任务触发后显示，切换菜单不丢失，任务结束 10 分钟后自动清除。
- **任务队列入口优化**：队列徽标移到输入框工具栏，点击工具栏图标即可查看队列详情。

![Atolla 系统架构](docs/architecture/atolla-architecture.png)

## 能做什么

- 用 Claude、Codex、Cursor Agent 创建数字员工，绑定工作区
- 首页和管理台流式对话；一个员工同时只做一件主任务
- 写文件、联网、删除等操作先审批，也可按会话自动放行
- 员工之间用 `@` 互相调用；项目协作用可视化流程图编排
- 手机通过远程中继只读查看和继续对话，Bark 通知可单独开关

## 开始使用

需要 Go 1.22+、Node.js 20+，以及至少一个引擎命令：`claude`、`codex` 或 `agent`。默认用 SQLite，无需 Docker；可选 MySQL 时再装 Docker。

```bash
cp .env.example .env
./scripts/start.sh
```

浏览器打开 http://localhost:5173 。第一次进入会检查引擎，并引导你注册管理员。

前台启动会占住终端；要关窗口仍保持运行，用后台模式：

```bash
./scripts/start-bg.sh
# 或 ./scripts/start.sh --daemon
```

日志在 `logs/backend.log`、`logs/frontend.log`。停止仍用 `./scripts/shutdown.sh`。

改用 MySQL（会起 docker compose）：

```bash
./scripts/start.sh --mysql
# 后台: ./scripts/start-bg.sh --mysql
```

停掉或重启：`./scripts/shutdown.sh`、`./scripts/restart.sh`（可加 `--daemon`）。

| 服务 | 地址 |
| --- | --- |
| 页面 | http://localhost:5173 |
| API | http://localhost:8080 |
| SQLite（默认） | `./data/atolla.db` |
| MySQL（可选） | `127.0.0.1:3307` |

## 技术栈

Go（Gin）· React（Vite）· SQLite（默认）/ MySQL 8（可选）· 本机 CLI 引擎

对话用 SSE 推流。手机中继是 HTTP 长轮询，不是 WebSocket。交互架构图：[docs/architecture/atolla-architecture.html](docs/architecture/atolla-architecture.html)。

## 配置

密钥放在仓库根目录的 `.env`，不要提交。常用项：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `AVATAR_ADDR` | API 监听地址 | `:8080` |
| `AVATAR_DB_DRIVER` | 平台库驱动 `sqlite` / `mysql` | `sqlite` |
| `AVATAR_DB_DSN` | sqlite 为文件路径；mysql 为连接串 | `./data/atolla.db` |
| `AVATAR_ALLOWED_IPS` | 允许访问的客户端 IP，空则看鉴权路径 | `127.0.0.1` |
| `AVATAR_ADMIN_USER` / `AVATAR_ADMIN_PASS` | 管理员账号 | 请改掉 |
| `BARK_KEY` | iPhone Bark 推送，可留空 | — |

完整列表见 [.env.example](.env.example)。

## 许可证

见 [LICENSE](LICENSE)。
