# 移动端实例会话持久化 + PC 设备管理

日期：2026-10-15  
状态：已实现  
范围：remote-relay（中继库 + 手机站）+ Atolla 管理台「远程中继」面板

## 1. 背景与目标

### 痛点

- 进实例的 6 位密码成功后，`unlock_token` 存在手机站 **sessionStorage**；iPhone 杀后台 / 丢弃标签后清空，需重新输入。
- 站点大门 token 已在 localStorage，一般仍在；痛点集中在**实例解锁**。
- PC 无法看到「谁在用手机访问本实例」，也无法踢下线。

### 目标

1. 实例解锁会话**记在中继服务器**；杀后台回来在有效期内免再输 6 位。
2. 用户可在手机**注销本机**；PC 可**踢任意设备**。
3. PC「远程中继」展示正在/曾访问的移动设备：iPhone SVG、绿/红点、设备信息、踢下线。

### 非目标

- 不改站点大门（site gate）登录模型。
- 不替代已有 `viewer.set` / `mobile_viewing`（那是「正在看哪个数字人」；本功能是「哪台手机解锁了实例」）。
- 不做多端推送踢人即时弹窗以外的复杂通知（踢后下次请求 403 即可；心跳失败则回解锁页）。

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 记住范围 | **仅实例 6 位解锁**（方案 A） |
| 在线判定 | **心跳**；约 90s 无上报 = 红点离线（会话可仍有效） |
| 会话 TTL | **7 天**；踢下线立刻作废 |
| 架构 | 服务端 `device_session` 表 + 手机 localStorage 存 session token |

## 3. 数据模型（remote-relay SQLite）

表名：`instance_device_sessions`

| 列 | 说明 |
|----|------|
| `id` | TEXT PK（opaque session id / UUID） |
| `instance_id` | TEXT NOT NULL，索引 |
| `token_hash` | TEXT NOT NULL（只存哈希，不下发明文二次） |
| `device_label` | TEXT（展示名，如「iPhone」；可由 UA 推断或客户端上报） |
| `user_agent` | TEXT |
| `client_ip` | TEXT |
| `created_at` | INTEGER ms |
| `expires_at` | INTEGER ms（创建 + 7d；可在心跳时滑动续期，见下） |
| `last_seen_at` | INTEGER ms（心跳 / 任意带 unlock 的请求可刷新） |
| `revoked_at` | INTEGER NULL（非空 = 已踢/已注销） |

可选索引：`(instance_id, revoked_at, expires_at)`。

**滑动续期（建议）：** 心跳成功且距过期 &lt; 3 天时，将 `expires_at` 延到 now+7d，避免每天用却突然到期；踢下线仍立即 `revoked_at`。

## 4. 鉴权变更

### 现状

- `POST /api/instances/:id/unlock` → 无状态 JWT（24h）+ 仅校验签名与 `instance_id`。
- 前端：`sessionStorage['relay_unlock:' + id]`。

### 目标

1. Unlock 成功：插入 `instance_device_sessions`，签发 **带 `sid` 的 unlock JWT**（或 opaque token；推荐 JWT + `sid` 以便 header 形态不变）。
   - Claims：`sub=instance_unlock`, `instance_id`, `sid`（session id）。
   - TTL claim 与行内 `expires_at` 对齐（7d）。
2. `requireInstanceUnlock`：验 JWT → 查表 `sid` 存在、未 revoke、未过期 → 通过；可选刷新 `last_seen_at`（节流，如 ≥30s 写一次，避免每条消息打库）。
3. 实例密码「注销」（已有 revoke password）时：**批量 revoke** 该 `instance_id` 下全部 session（与现有吊销语义一致）。

### 兼容

- 旧 JWT（无 `sid`）：拒绝，要求重新解锁（或过渡期仍接受至其 24h 过期；实现时优先**直接要求带 sid**，改动简单）。

## 5. API

### 5.1 手机站（site JWT + 部分需 unlock）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/instances/:id/unlock` | body 增加可选 `device_label`；响应仍含 `unlock_token`、`expires_in`，另加 `session_id` |
| `POST` | `/api/instances/:id/sessions/heartbeat` | 需 unlock；刷新 `last_seen_at`（及滑动续期） |
| `DELETE` | `/api/instances/:id/sessions/me` | 需 unlock；revoke 当前 sid；前端清 localStorage |
| `GET` | `/api/instances/:id/sessions` | （可选，手机自查）需 unlock；仅返回当前 session 摘要 |

Unlock body 建议：

```json
{ "password": "123456", "device_label": "iPhone" }
```

`device_label` 可由前端根据 UA 粗分：`iPhone` / `iPad` / `Android` / `Desktop`。

### 5.2 Mac 设备通道（instance_id + password，供 Atolla 桥接）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/device/mobile-sessions` | 列出本实例 session（含在线状态字段） |
| `DELETE` | `/api/device/mobile-sessions/:sessionId` | 踢下线（写 `revoked_at`） |

列表项示例：

```json
{
  "session_id": "...",
  "device_label": "iPhone",
  "user_agent": "...",
  "client_ip": "...",
  "created_at": 0,
  "expires_at": 0,
  "last_seen_at": 0,
  "online": true,
  "revoked": false
}
```

`online = !revoked && now - last_seen_at <= 90_000`。

### 5.3 Atolla 管理台

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/remote-relay/mobile-sessions` | 桥接调用中继 `GET .../mobile-sessions` |
| `DELETE` | `/api/admin/remote-relay/mobile-sessions/:sessionId` | 桥接踢人 |

桥接未运行 / 未配置：返回明确错误（与现有 status 一致），UI 显示「桥接未连接」。

## 6. 前端行为

### 6.1 remote-relay/web（手机）

- `setUnlockToken` / `getUnlockToken`：**改用 localStorage**（key 仍可用 `relay_unlock:` 前缀）；另存 `relay_unlock_sid:` 可选。
- 进入实例：若本地有 token，直接进；首个 API 403 → 清 token 并弹 6 位框。
- 实例页（Hub / Agents / Chat）：`visibilitychange` + 定时器（建议 **30s**）调 heartbeat；页面隐藏可降频或暂停。
- 实例设置或顶栏增加 **「注销本机解锁」** → `DELETE .../sessions/me`。
- 站点大门 logout（`clearToken`）时：清 site token；**是否清 unlock**：建议一并清本地 unlock（本机不再带旧 header）；服务端 session 仍可至过期或由 PC 踢——或 logout 时调 `sessions/me`（若仍有 unlock）。推荐 logout 时尽量调 revoke me。

### 6.2 Atolla `RemoteRelayPanel`（PC）

在现有状态卡片附近新增 **「移动端访问」** 区块：

- 轮询 GET mobile-sessions（如 10–15s，面板 active 时）。
- 每台设备一张卡片：
  - 左侧 iPhone（或按 label 选 iPhone/Android）SVG 线稿
  - 右上角绿/红小圆点（在线/离线）
  - 文案：设备名、IP、最近活跃相对时间、过期时间
  - 操作：**踢下线**（确认 Modal）
- 空态：尚无移动设备会话。
- 视觉：贴合现有 `rr-*` / version-card，避免另起一套皮肤；绿点可轻微呼吸动画（与现有 `rr-dot running` 一致）。

## 7. 与现有能力关系

| 能力 | 关系 |
|------|------|
| `viewer.set` / PC 聊天「手机在看」图标 | 正交；会话在线 ≠ 正在看某 agent |
| 实例密码吊销 | 批量 revoke 全部 device session |
| unlock 错密锁定 | 不变（IP + instance） |

## 8. 安全注意

- DB 只存 `token_hash`（sha256(token) 即可）。
- Kick / revoke 后旧 JWT 即使未过期也失败。
- 列表接口仅 Mac 实例凭证或管理台 JWT，不对公网匿名开放。
- 心跳不能延长到无限而不设上限：滑动续期上限可定为「自 created_at 起最长 30 天」或仅允许在 expires 窗口内 +7d（采用后者更简单）。

## 9. 测试要点

- Unlock → 写 session → localStorage 杀进程模拟（清 sessionStorage 保留 localStorage）仍可进。
- Heartbeat 刷新 online；停心跳 &gt;90s → `online=false`，仍可调需 unlock 的 API。
- `sessions/me` 与 PC kick → 随后 API 403。
- 密码吊销 → 全部 session 失效。
- 管理台桥接未开 → 错误文案可读。

## 10. 实现顺序（供 plan 拆分）

1. remote-relay：表 + unlock/verify/heartbeat/revoke/me + device list/kick  
2. remote-relay/web：localStorage + heartbeat + 注销本机  
3. Atolla bridge + admin API  
4. RemoteRelayPanel UI  
5. 测试 + CHANGELOG（remote-relay + Atolla web changelog）

## 11. 开放细节（实现时按默认）

- Heartbeat 间隔：**30s**；在线阈值：**90s**。
- 旧无 sid 的 JWT：**一律拒绝**（发版后需重新解锁一次）。
- 设备图标：label 含 iPhone/iPad → iPhone SVG；Android → 简洁手机框；其它 → 通用设备。
