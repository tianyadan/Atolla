# Atolla iOS 壳（Capacitor）

把现有移动端 Web 打成可真机安装的 iOS App（**不上架 App Store** 也可：数据线 / Ad Hoc）。

## 前提

- macOS + **完整 Xcode**（App Store）
- Node 18+
- iPhone（如 16 Pro Max）用数据线，并在 Xcode 登录 Apple ID（Personal Team 即可）

## 一键同步并打开 Xcode

```bash
cd remote-relay/web
npm install
# 可选：写入默认中继地址，免去首次手填
# echo 'VITE_API_BASE=https://你的中继域名' > .env

npm run ios
```

首次会生成 `ios/` 工程。之后改前端：

```bash
npm run cap:sync   # build + cap sync
# 再在 Xcode 里 Run，或再执行 npm run cap:open
```

## Xcode 真机

1. 打开工程后选中 **App** target → **Signing & Capabilities**
2. Team 选你的 Apple ID（Personal Team）
3. Bundle ID 默认 `com.atolla.relay`（若冲突可改成 `com.atolla.relay.你的名字`）
4. 顶部设备选 **iPhone 16 Pro Max** → Run ▶
5. 手机：**设置 → 通用 → VPN 与设备管理** 里信任开发者证书

## 首次登录

App 内无浏览器同源代理，登录页需填写 **Relay API URL**（中继根地址，如 `https://xxx` 或局域网 `http://192.168.x.x:3080`）。

也可在 **设置 → 中继服务** 修改。构建时可用 `.env` 的 `VITE_API_BASE` 预填。

## HTTP / 公网 IP

App 页在壳内是 `https://localhost`，用浏览器 `fetch` 打公网 `http://` 会被当成**混合内容**直接失败（表现常为 Load failed / 无法连接中继），**与密码无关**。

已开启 `CapacitorHttp`（原生发请求）+ `NSAllowsArbitraryLoads`。改完后必须：

```bash
cd remote-relay/web && npm run cap:sync
# Xcode 里重新 Run 到手机（不要只刷新 Web）
```

- 地址示例：`http://122.51.86.159:13080`
- 手机 Safari 能打开同一地址再试 App
- 密码错误时文案是 Incorrect site password，不是「无法连接」

## 观感相关已做

- **全面屏**：`contentInset: never` + StatusBar `overlay: true` + `safe-area-inset-*`
- `viewport-fit=cover` + 顶栏吃进刘海 / Dynamic Island
- 键盘 Resize（Capacitor Keyboard）
- 禁橡皮筋、禁双击缩放

## 灵动岛（Live Activity）

忙碌数字人会「上岛」（参考 Mac Atolla Island）：列表轮询 → `AtollaIsland.syncBusy` → ActivityKit。

- 需要 **真机 + iOS 16.2+**（模拟器灵动岛能力有限）
- Widget Extension：`AtollaIslandWidget`（Bundle `com.atolla.relay.AtollaIslandWidget`）
- 若 Xcode 工程缺 Extension，在 `ios/` 执行：

```bash
gem install xcodeproj --user-install
ruby scripts/ensure_island_widget.rb
```

Signing：App 与 Widget 选同一 Team；Personal Team 即可。

## 目录

| 路径 | 说明 |
|------|------|
| `capacitor.config.ts` | AppId / 插件 |
| `ios/` | Xcode 工程（`cap add ios` 生成） |
| `ios/App/App/AtollaIslandPlugin.swift` | 上岛原生插件 |
| `ios/App/AtollaIslandWidget/` | Live Activity UI |
| `src/nativeShell.ts` | 原生壳初始化 |
| `src/islandLiveActivity.ts` | JS ↔ 灵动岛 |
| `src/utils/apiBase.ts` | API 根地址 |
