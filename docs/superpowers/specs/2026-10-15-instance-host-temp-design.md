# 实例主机温度（heartbeat.host.temp_c）

## 目标

PC 心跳上报代表性温度 `temp_c`（℃），移动端实例页与 CPU/内存/磁盘并列展示。

## 方案

- 扩展 `CollectHostMetrics` + heartbeat `host.temp_c`（可选；读不到则省略）。
- remote-relay `hostMetaSchema` / `InstanceHostMeta` 增加 `temp_c`。
- Instances 资源网格增加「温度」卡片；详情页展示。

## 取值

- 过滤合理范围 [5, 120]℃。
- 优先 CPU/Package/tdie/TC0/core 类传感器的最高值；否则取全部有效传感器最高值。
- 一位小数。

## 发布

先升云端 remote-relay，再重启本机 Atolla。
