# Atolla

[English](README_EN.md)

在你自己的电脑上跑一队数字员工。员工背后是本机的 Claude、Codex 或 Cursor Agent，在授权过的工作区里干活，危险操作先问你再执行。

当前版本 **v0.6.5**。

**v0.6.5 新特性：**
- **GitHub Idea 调度**：监听 Issue，按岗位、能力标签与负载推荐数字员工，支持幂等入队、历史审计和失败重派。
- **iOS 与 Siri**：支持查询数字员工、查看进度、下发任务和询问前台，并完善深链、任务规划与灵动岛同步。
- **远程使用优化**：站点登录有效期延长至 30 天，补齐移动端凭据、用量小组件和异常恢复链路。

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

## macOS 桌面版（Apple Silicon）

Electron 桌面版会自动启动内置 Go 后端并复用现有 Web 界面。开发、打包、运行目录和未签名分发限制见 [docs/electron-macos.md](docs/electron-macos.md)。

## 许可证

见 [LICENSE](LICENSE)。
