# remote-relay 实例进入解锁（v0.0.1）

日期：2026-10-13  
状态：已确认

## 要点

- 实例列表：Mac SVG、进入、注销（原吊销）；注销用自研 Modal
- 进入前校验 6 位实例密码；成功发 `unlock_token`（JWT，24h，含 instance_id）
- 详情 API（agents/tasks/messages/sync）强制 `X-Instance-Unlock`
- 错 5 次锁 5 分钟（IP + instance_id）
- 版本记 `remote-relay/CHANGELOG.md` v0.0.1
