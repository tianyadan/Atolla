# LAN 写操作幂等与安全回退 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证同一已配对 iPhone 的 LAN 写操作至多在 Mac 执行一次，并避免响应丢失时自动回退云端造成重复执行。

**Architecture:** 在独立 LAN Relay 的动作入口引入受 HMAC 认证的 `X-Atolla-Idempotency-Key`，以“设备 ID + 动作名 + 键”缓存运行中及已完成结果。移动端为一次写操作生成键；仅在 LAN 尚未尝试执行（例如健康检查失败）时允许使用既有云端通道。实际动作请求超时、断连或服务端 5xx 后返回确定性“执行状态未知”错误，不进行云端重放。

**Tech Stack:** Go 1.22 标准库 HTTP、Go testing、React/TypeScript、Capacitor HTTP。

**Spec:** `docs/lan-relay-remaining-work.md`（P0-3）与 `docs/superpowers/specs/2026-11-14-lan-relay-design.md`。

## Global Constraints

- 不修改腾讯云 Remote Relay 的路由、数据库迁移、部署配置或既有客户端协议。
- 仅使用 HTTP；不将长期密钥、云端 JWT 或设备密钥写入正文、查询参数或日志。
- LAN 请求必须继续执行设备 HMAC、时间戳、nonce 与私网来源校验。
- 禁止无幂等保障的跨通道自动重放写操作。
- 不执行删除命令，不清理用户既有构建产物。

## Review Focus

- 相同幂等键、相同动作并发到达时，执行器只能被调用一次，其余请求必须等待并复用结果。
- 相同幂等键被用于不同动作或不同请求体时，必须返回冲突，不能复用错误结果。
- 首次执行完成后网络响应丢失，重试必须返回缓存结果，不再次调用执行器。
- 运行中请求超过等待上限时，客户端不得将该操作转发云端。
- 旧客户端缺失幂等键时，LAN 写入必须拒绝，不能退化为不安全执行。

### Task 1: 服务端动作幂等注册表

**Files:**
- Modify: `server/internal/lanrelay/server.go`
- Modify: `server/internal/lanrelay/server_test.go`

**Interfaces:**
- Produces: `POST /lan/v1/actions` 要求 `X-Atolla-Idempotency-Key`，并以认证设备、动作和请求体摘要去重。
- Produces: 完成结果在有限 TTL 内可重放；运行中重复请求等待首次执行完成。

- [x] **Step 1: 写入失败测试：相同键的并发动作只执行一次**

  测试应创建阻塞执行器，同时提交两个拥有相同设备、动作、正文和幂等键的签名请求，断言第二个请求等待，释放后两者均成功，执行次数为 1。

- [x] **Step 2: 运行测试确认失败**

  Run: `go test ./internal/lanrelay -run TestActionIdempotency -count=1`
  Expected: FAIL，因为动作入口尚未识别幂等键。

- [x] **Step 3: 在 `server.go` 实现受签名保护的幂等注册表**

  `Server` 新增有界 TTL 记录；canonical HMAC 字符串追加幂等键值。动作请求缺键、键非法、同键不同动作/正文均返回稳定客户端错误。首次请求负责执行并缓存完整 HTTP 响应；重复请求等待或返回缓存响应。

- [x] **Step 4: 运行定向测试确认通过**

  Run: `go test ./internal/lanrelay -run TestActionIdempotency -count=1`
  Expected: PASS。

- [x] **Step 5: 增加冲突与响应丢失重试测试并运行包测试**

  覆盖相同键不同正文拒绝，以及首次执行完成后的相同键重试不再调用执行器。

  Run: `go test ./internal/lanrelay -count=1`
  Expected: PASS。

### Task 2: 移动端写入策略与故障注入

**Files:**
- Modify: `remote-relay/web/src/utils/lanConnection.ts`
- Modify: `remote-relay/web/src/api.ts`
- Create: `remote-relay/web/src/utils/lanConnection.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `X-Atolla-Idempotency-Key` 与扩展后的 HMAC canonical 格式。
- Produces: `callLanAction` 接受调用方生成的幂等键，并区分“未执行 LAN”与“LAN 执行状态未知”。
- Produces: `request` 对 LAN 写操作不在未知结果后自动回退云端。

- [x] **Step 1: 写入失败测试：LAN 响应丢失不触发云端请求**

  为纯函数形式的路由决策/错误分类添加测试：LAN 动作已开始后出现网络超时，策略为 `auto` 时返回 `LanActionOutcomeUnknownError`，云端回退回调未执行。

- [x] **Step 2: 运行测试确认失败**

  Run: `npm --prefix remote-relay/web test -- lanConnection.test.ts`
  Expected: FAIL，因为当前代码会捕获所有 LAN 异常并继续云端请求。

- [x] **Step 3: 实现幂等键签名与安全回退决策**

  为每次 `lanActionForRequest` 返回稳定的随机键；`signedLanRequest` 将键写入 header 并纳入 HMAC。连接不可达且动作尚未发送时可使用云端；动作发送后任意网络不确定性抛出状态未知错误。`lan_only` 始终不回退。

- [x] **Step 4: 运行定向测试确认通过**

  Run: `npm --prefix remote-relay/web test -- lanConnection.test.ts`
  Expected: PASS。

- [x] **Step 5: 构建与回归验证**

  Run: `npm --prefix remote-relay/web run build && go -C server test ./internal/lanrelay ./internal/remotebridge ./internal/service && git diff --check`
  Expected: 全部命令退出码为 0。

### Task 3: 文档与验收结论

**Files:**
- Modify: `docs/lan-relay-remaining-work.md`

**Interfaces:**
- Consumes: Task 1、Task 2 的验证结果。
- Produces: P0-3 完成状态、自动回退的明确边界及尚未解决的跨云端全局幂等限制。

- [x] **Step 1: 更新 P0-3 现状和验收描述**

  记录 LAN 端幂等、故障注入结果，以及因云端协议不变而禁止“结果未知后自动云端重放”的理由。

- [x] **Step 2: 运行最终验证并检查文档差异**

  Run: `npm --prefix remote-relay/web run build && go -C server test ./internal/lanrelay ./internal/remotebridge ./internal/service && git diff --check`
  Expected: 全部命令退出码为 0。

## Self-Review

- P0-3 的“只执行一次”由 Task 1 的并发、冲突与重试测试覆盖。
- 跨通道重复执行风险由 Task 2 的“状态未知不回退”测试覆盖；不依赖未改造的腾讯云命令队列提供幂等性。
- HMAC 与幂等键绑定、旧客户端缺键拒绝、执行器缓存容量与 TTL 由 Task 1 覆盖或在实现中限界。
- 本计划不涉及 P0-2 的新增业务动作映射、P1 配对/Keychain/Bonjour 或 P2 真机验收。
