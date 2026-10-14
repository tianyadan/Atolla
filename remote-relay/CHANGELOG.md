# Atolla Remote Relay 变更历史

本文件仅记录 **remote-relay**（移动端 + API 中继），与 Atolla 本体管理台版本无关。

## v0.0.3 — 2026-10-14

- 对话页「命令审批设置」：同步 PC「命令全部审批通过」与「自动审核」（`agent.set_auto_approve_all` / `agent.set_auto_review`）
- 人工授权弹窗：Mac 推送待授权镜像；手机可拒绝 / 本次允许 / 本次会话允许（`permission.decide`）
- agents 镜像增加 `auto_review`、`auto_approve_all`；新增 `permissions_mirror`
- 部署脚本：远端无 npm 时自动装 Node.js 20 + 编译工具；SSH 复用连接少输密码；重部署保留 JWT
- 部署脚本可选 `--china-mirror`：Node 二进制与 npm registry 走 npmmirror（默认关闭）
- 修复：手机裁决后弹窗反复出现（decide 立即清镜像 + 本机防回灌）；Mac `auto_review` 重新接入自动放行链路
- 管理台「一键升级」：`deploy/upgrade.sh` 同步代码并重启，保留远端 env（门禁/JWT/端口）
- 管理台「一键部署 / 一键升级」按钮：本机 Atolla 执行脚本并用 SSE 实时显示日志；点击时输入云机 SSH 密码（可留空走密钥）
- 修复：一键 SSH 密码认证失败（sshpass 不兼容 `ssh -f`；密码模式下禁用本机默认公钥以免耗尽 MaxAuthTries）
- 修复：升级后 health check 过早（curl exit 7）；改为最多等 45s，失败时打印 systemctl/journalctl

## v0.0.2 — 2026-10-13

- 实例列表右上角设置：展示当前版本；更新记录支持游标无限滚动（新版本在上）
- 进入实例后 4 宫格 Hub：数字员工 / 群聊（开发中）/ 占位
- 数字员工按工作组分组，状态仅展示空闲 / 忙碌中；点击直达对话
- 对话页：头像/名称/状态、任务规划开关与进度条、文字发送/插话/终止（`agent.ask` / `agent.stop` / `agent.set_task_plan`）
- 对话区默认只加载最近消息，上滑加载更早历史；发送后滚到底；数字人信息固定顶栏
- 对话页持续 `sync.messages`；Mac 在 `agent.ask` 完成后主动推送消息镜像，移动端可及时看到回复
- 助手消息 Markdown 渲染；用户气泡按内容自适应宽度并右对齐
- 执行命令按 PC 风险色区分展示（低/中/高/拒绝），不再混入普通气泡
- 登录首页：居中水母 Logo + Atolla / Remote Relay 英文文案
- 实例页深色管理 UI（搜索/状态筛选/主机指标卡片）；Mac 心跳上报 OS/IP/运行时长/CPU/内存/磁盘
- Mac 同步增强：头像、工作组、任务规划开关；消息镜像可带附件元数据

## v0.0.1 — 2026-10-13

- 实例列表：Mac SVG 标识、在线状态
- 「进入」前校验该机 6 位实例密码；签发 24h `unlock_token`，详情 API 强制校验
- 连续输错 5 次锁定 5 分钟
- 「吊销」更名为「注销」，使用自研 Modal（无浏览器原生弹窗）
