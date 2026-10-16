# Atolla Remote Relay 变更历史

本文件仅记录 **remote-relay**（移动端 + API 中继），与 Atolla 本体管理台版本无关。

## v0.0.15 — 2026-10-16

- 设置页新增「通知」：可开关完成通知和命令审批通知，与电脑端同一份偏好
- 中继增加 `notify.prefs.get` / `notify.prefs.update`，由已解锁的 Mac 实例读写

## v0.0.14 — 2026-10-15

- 实例页展示主机温度：心跳 `host.temp_c`（℃），卡片与详情并列 CPU/内存/磁盘

## v0.0.13 — 2026-10-15

- 移除「拍照」按钮，仅保留相册选图；状态 pill 文案缩短为「忙/闲」并收窄样式

## v0.0.12 — 2026-10-15

- 对话附图拆分「相册 / 拍照」：默认从相册选图（含截屏），不再强制打开摄像头

## v0.0.11 — 2026-10-15

- 移动端对话支持图片：压缩后经中继上传 Mac/OSS，发送前可删预览，历史气泡可查看大图
- `agent.ask` 支持 attachments；`chat.image.upload` RPC；OSS chat/ 前缀 7 天生命周期 + 本地定时清理

## v0.0.10 — 2026-10-15

- 数字人菜单 / 对话页增加员工设置：可编辑系统提示词、技能商店安装卸载、只读查看继承记忆
- 中继新增 `enqueueAndWait` 与 settings/skills/legacy-mounts RPC；Mac bridge 同步注册对应 actions

## v0.0.9 — 2026-10-15

- agents 快照全量替换：未出现在本批的 agent 从镜像删除；允许空数组清空
- 移动设备会话列表隐藏已踢会话，并按 label+UA+IP 去重；同设备再解锁会吊销旧会话

## v0.0.8 — 2026-10-15

- 实例解锁改为服务端设备会话（7 天）：unlock JWT 绑定 `sid`，可踢下线 / 注销本机
- unlock token 改存 localStorage（杀后台不再丢）；实例页 30s 心跳；Hub「注销本机解锁」
- Device API：`GET/DELETE /api/device/mobile-sessions` 供 Mac/管理台列表与踢人

## v0.0.7 — 2026-10-15

- 实例页主题开关改为全局浅色/深色（localStorage 持久化，全站 CSS 变量生效）
- 设置入口 SVG 改为齿轮；主题按钮按当前模式显示太阳/月亮

## v0.0.6 — 2026-10-15

- 上下文圆环缩小（22px）；与 PC 同源 `used_percent`；超过窗口环内显示 `!`（不再出现 191%）
- 数字员工菜单 / Hub「数字员工」角标：黄色忙碌人数徽标
- 对话输入草稿 session 缓存 + 一键清空；状态 pill 缩小且忙碌色更醒目

## v0.0.5 — 2026-10-14

- 数字员工列表：折叠状态按实例持久化；一键全部展开 / 全部折叠
- 对话：发送后 ChatGPT 风格「正在思考」动效；助手气泡改数字人头像+名称；非命令回复可复制
- 对话：visualViewport 顶起输入框，避免被输入法遮挡；输入区右下角上下文占用圆环（环内百分比）

## v0.0.4 — 2026-10-14

- 数字员工列表：工作组支持折叠/展开（默认全部展开）；顶栏搜索按钮展开输入框，300ms 防抖按名称/ID 过滤分组

## v0.0.3 — 2026-10-14

- 对话页上报 `viewer.set` / `viewer.clear`（心跳）：PC 可显示「手机端正在查看」图标，并与 PC 近实时同步同会话消息
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
