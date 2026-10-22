# Atolla Island（macOS 灵动岛）

可选组件：在 Mac 刘海/顶部展示**正在运行的数字人**，点击跳转 Atolla 管理台对话。

本目录为**纯源码**，不含编译二进制。可随 Atolla 仓库使用，也可单独拷到 GitHub 自用。

## 依赖

- macOS 14+
- 完整 Xcode（含 Swift / macOS SDK；仅 Command Line Tools 不够）
- 本机已运行 Atolla 后端（默认 `http://127.0.0.1:8080`）并登录过管理台

## 一键安装（推荐）

在 Atolla 管理台 → **设置 → 灵动岛** → 点「安装」（会编译并注册 LaunchAgent）。

或在本目录手动：

```bash
# 可选：指定 Xcode
# export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

./scripts/install-launchagent.sh
```

安装结果：

- 二进制：`~/.atolla/bin/AtollaIsland`（本机生成，不进 git）
- LaunchAgent：`com.atolla.island`（登录常驻）

## 仅临时运行（不装 LaunchAgent）

```bash
./scripts/run.sh
```

## 卸载 / 关闭

管理台胶囊开关关闭，或：

```bash
./scripts/uninstall-launchagent.sh
```

## 与 Atolla 的衔接

登录管理台后会写入 `~/.atolla/island.json`（API / Web 地址 + Token）。  
岛进程轮询 `GET /api/admin/island/busy`，点击打开 `/?agent=<id>`。

## 目录结构

```
macos/AtollaIsland/
  Package.swift
  Sources/AtollaIsland/   # Swift 源码
  scripts/                # install / uninstall / status / run
  README.md
```
