# remote-relay 一键升级（管理台）

日期：2026-10-14  
状态：已确认（方案 A）

## 目标

在管理台「远程中继」提供「一键升级」：本机复制命令，rsync 新代码到已部署云机，保留门禁/JWT/端口，重启服务。

## 行为

| 项 | 说明 |
|----|------|
| 脚本 | `remote-relay/deploy/upgrade.sh` |
| 必填 | `--host`；可选 `--user` `--ssh-port` `--remote-dir` `--china-mirror` `--fix-apt` |
| 不需要 | `--site-password`、`--port` |
| 保留 | `/etc/atolla-remote-relay.env`（不重写） |
| 流程 | SSH 复用 → rsync（排除 node_modules / data / dist）→ 缺 Node 才装 → npm ci && build → 更新 unit → restart → health（读 env PORT） |
| 失败 | 无 env 或未安装过 → 报错，提示用「服务器部署」 |

## UI

- 独立卡片「一键升级」；复用部署表单的 SSH / 目录 / China-mirror
- 不要求门禁密码；「复制升级命令」

## 非目标

- 浏览器内直接 SSH 执行
- 升级时改写 SITE_PASSWORD
