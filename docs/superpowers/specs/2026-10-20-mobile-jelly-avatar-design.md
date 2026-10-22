# 移动端像素水母头像（方案 A）

## 目标

移动端数字员工头像与 PC 一致：像素水母展示 + 设置页可改 `jelly_color`。

## 范围

- 合入后端 `jelly_color`（DB / store / agents 镜像）。
- 扩展 `agent.settings.get/update` 读写 `jelly_color`。
- `remote-relay/web`：移植 Jelly 组件与 sprites；替换 Agents / Chat / 设置继承记忆等处的上传头像图。
- 设置基础 Tab：`JellyColorPicker`，与提示词一并保存。

## 非目标

- 不改实例页监控图标；不恢复上传头像流程。
- 不新建独立改色 RPC。

## 发布

先升云端 remote-relay，再重启本机 Atolla（含迁移）。
