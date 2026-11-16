# Electron macOS Desktop Design

## Intent

将 Atolla 现有的 Go + React Web 应用封装为可双击启动的 macOS 桌面应用。第一版只支持 Apple Silicon，不改变数字员工、审批、SSE、SQLite 和现有 macOS 灵动岛的业务能力。

## Goals

- 交付 `Atolla.app` 和安装用 `.dmg`。
- 启动 App 后自动拉起内置的 Go 后端，后端健康后显示主窗口。
- 保持前端相对路径 `/api`，包括现有 SSE 流。
- 将运行时 SQLite、日志与桌面配置放至 `~/Library/Application Support/Atolla/`。
- 退出窗口或应用时受控停止由本次启动的 Go 子进程。

## Non-goals

- 不支持 Intel Mac、Windows、Linux、自动更新、Apple 签名和公证。
- 不重写 React UI、Go API、认证或 SSE 协议。
- 不将 Node.js 能力暴露给渲染进程。
- 不修改现有 `macos/AtollaIsland` 的构建或发布流程。

## Architecture

Electron 主进程是唯一桌面编排层。开发环境中它启动源码目录的 Go 服务并加载 Vite；发布环境中它启动应用资源中的 `darwin/arm64` Go 二进制，后端同时托管 Vite 构建产物。这样页面始终从同一 loopback origin 加载，已有 `/api` 请求、Cookie 与 SSE 无需改写。

启动时主进程为后端分配一个仅监听 `127.0.0.1` 的可用端口，传入数据、日志、静态资源和配置目录；轮询 `/health` 成功后才创建窗口。异常退出、超时与端口冲突必须显示可恢复的错误，不得静默打开空白页面。

## Data and Security

- Electron 使用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- 预加载层不提供通用 shell、文件系统或进程执行 API；第一版不需要业务 IPC。
- 后端仅允许回环地址，并继承现有 `AVATAR_ALLOWED_IPS=127.0.0.1,::1` 语义。
- SQLite 放在应用支持目录的 `data/atolla.db`；日志放在 `logs/`；用户配置放在 `config/`。首次运行时创建目录，不覆盖已有数据。
- 子进程仅接收白名单环境变量；不把 `.env` 复制进应用包。

## Packaging

- 新增独立 `desktop/` Node 工程，使用 Electron 和 electron-builder。
- 构建顺序：构建 `web/dist`、编译 `server` 为 `darwin/arm64` 二进制、将两者作为 `extraResources` 写入 App 的 `Resources`、生成 arm64 DMG。
- 运行时资源通过 `process.resourcesPath` 定位；开发环境通过仓库根目录定位。
- 不签名时构建产物仅适合本机或手动放行测试；分发前的 Developer ID 签名和 notarization 另立任务。

## Alternatives

- Electron 仅打开已运行的浏览器站点：用户仍需手动启动服务，不满足双击即用。
- `file://` 加载 Vite 产物：相对 `/api` 会指向本地文件协议，且 SSE/认证路径需要重写。
- Tauri：包体更小，但偏离 Electron 选择且引入 Rust 维护面。

## Acceptance Criteria

- 在 Apple Silicon Mac 上安装后双击 App，可完成首次注册或登录并正常发起 SSE 对话。
- 应用支持目录外不生成数据库、PID 或运行日志。
- 后端启动失败、端口不可用或健康检查超时时，用户能看到错误且不会残留孤儿后端。
- 退出 App 后本次启动的后端进程不再监听其端口。
