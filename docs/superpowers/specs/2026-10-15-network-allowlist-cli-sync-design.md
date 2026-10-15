# 网络白名单 + 多 CLI 同步

日期：2026-10-15  
状态：已实现  
版本：Atolla **v0.5.2**

## 决策

| 项 | 选择 |
|----|------|
| 范围 | 管理台设置 + 同步本机 CLI |
| 数字人外联 | 「允许联网」= 用户授权，公开 API 直接放行（不按域名二次弹窗） |
| 源真值 | MySQL `network_allowlist`（同步/文档用，非第二道人工闸） |

## 行为摘要

1. 管理台「网络白名单」CRUD → PUT 后同步本机 CLI，并**放宽出站**（Cursor `default=allow`，Claude 关 Bash 沙箱，Codex `network_access=true`）
2. Gateway：`AllowNetwork` + 网络类动作 → 直接 ALLOW
3. Cursor Desktop Agent Shell 仍受 IDE Network access 约束；需 sandbox.json + Defaults 或 Allow All
4. Hard Deny / 私网元数据入库拒绝不变

## 种子

- `restapi.amap.com`
- `*.amap.com`
