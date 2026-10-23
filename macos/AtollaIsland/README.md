# Atolla Island（macOS 灵动岛）

可选组件：在 Mac 刘海/顶部展示**正在运行的数字人**，点击跳转 Atolla 管理台对话。

## 别人怎么装（推荐：预编译，无需 Xcode）

1. 从 GitHub **Releases** 下载 `AtollaIsland-macos-<你的芯片>-….zip`
2. 解压后执行 `./install.sh`
3. 打开 Atolla 管理台 **登录一次**（自动写凭证）

详细步骤、排错见 **[INSTALL.md](./INSTALL.md)**。

> 无苹果开发者证书也可分发：包未签名，安装脚本会清除隔离属性；若仍被拦，对 `AtollaIsland` 右键 → 打开。

## 依赖

- macOS 14+
- Atolla 后端已运行，并登录过管理台（或手动 `configure.sh`）
- **预编译用户**：不需要 Xcode  
- **从源码编译**：需要完整 Xcode（仅 Command Line Tools 不够）

## 发布者：打预编译包

本机有 Xcode 时：

```bash
./scripts/package-release.sh
# 产物：dist/AtollaIsland-macos-<arch>-<stamp>-<git>.zip
# 上传到 GitHub Releases，并把 INSTALL.md「别人怎么用」贴到 Release 说明
```

本地试装预编译目录：

```bash
cd dist/stage && ./install.sh
```

## 从源码一键安装（开发机）

管理台 → **设置 → 灵动岛** →「安装」，或：

```bash
./scripts/install-launchagent.sh
```

安装结果：

- 二进制：`~/.atolla/bin/AtollaIsland`
- LaunchAgent：`com.atolla.island`（登录常驻）

## 仅临时运行

```bash
FOREGROUND=1 ./scripts/run.sh
```

## 卸载 / 关闭

```bash
./scripts/uninstall-launchagent.sh
# 预编译包内：./uninstall.sh
```

## 与 Atolla 的衔接

登录管理台后写入 `~/.atolla/island.json`（API / Web + Token）。  
岛每 2.5 秒轮询 `GET /api/admin/island/events`，按“报错 > 命令审批 > 运行中 > 已完成”展示当前最高优先级；点击可定位数字人，审批事件会额外携带 `approval_request_id` 精确定位命令。

## 目录结构

```
macos/AtollaIsland/
  Package.swift
  Sources/AtollaIsland/   # Swift 源码
  scripts/                # install / package-release / configure / uninstall
  INSTALL.md              # 预编译用户说明书
  README.md
  dist/                   # package-release 产物（不进 git）
```
