# Atolla Island — 预编译安装（无需 Xcode）

Mac 顶部「灵动岛」：展示正在忙碌的数字人，点击跳转 Atolla 管理台。

本说明面向 **从 GitHub Release 下载 zip** 的用户。不需要安装 Xcode / 开发者证书。

## 你需要

- macOS 14 或更高
- 已能打开的 Atolla（后端 + 管理台），默认本机 `http://127.0.0.1:8080`
- 与包名匹配的芯片：`arm64` = Apple Silicon（M 系列）；`x86_64` = Intel

## 别人怎么用（三步）

### 1. 下载并解压

到仓库 Releases 下载对应芯片的包，例如：

`AtollaIsland-macos-arm64-YYYYMMDD-xxxx.zip`

解压后得到文件夹，里面有 `install.sh`、`AtollaIsland`、`AtollaIsland_AtollaIsland.bundle/`（SPM 资源包，须与二进制同目录）、`jelly-sprites/` 等。缺少 `.bundle` 时进程会在启动时 fatal。

### 2. 一键安装

打开「终端」，进入解压目录后执行：

```bash
cd ~/Downloads/AtollaIsland-macos-arm64-…   # 改成你的解压路径
chmod +x install.sh configure.sh uninstall.sh
./install.sh
```

脚本会：

- 清除下载隔离属性（没有苹果签名时必需）
- 把程序装到 `~/.atolla/bin/AtollaIsland`
- 同步安装 `AtollaIsland_AtollaIsland.bundle`（与二进制同目录）
- 注册开机常驻（LaunchAgent）

若系统仍弹「无法验证开发者」：在访达中对该文件夹里的 `AtollaIsland` **右键 → 打开 → 仍要打开**，然后再跑一次 `./install.sh`。

### 3. 配置凭证（二选一）

**方式 A（推荐）**  
打开 Atolla 管理台并 **登录一次**。登录后会自动写入 `~/.atolla/island.json`，岛开始显示忙碌数字人。

**方式 B（手动）**

```bash
# 交互填写
./configure.sh

# 或环境变量一次写好
ATOLLA_TOKEN='你的管理台Token' \
ATOLLA_API_BASE='http://127.0.0.1:8080' \
ATOLLA_WEB_BASE='http://127.0.0.1:5173' \
./configure.sh
```

Token：在管理台登录成功后，从浏览器开发者工具 Application → Local Storage，或登录接口返回里复制。

## 卸载 / 关闭常驻

```bash
./uninstall.sh
```

只停 LaunchAgent，不删 `~/.atolla/bin` 里的程序，方便以后再开。

## 常见问题

| 现象 | 处理 |
|------|------|
| 岛不出现 | 看 `~/.atolla/island.err.log`；确认 `./install.sh` 成功且进程在跑；确认 `~/.atolla/bin/AtollaIsland_AtollaIsland.bundle` 存在 |
| 日志含 missing bundle / Bundle.module | zip 未带 `AtollaIsland_AtollaIsland.bundle`；换新版包重装，或把该 bundle 放到 `~/.atolla/bin/` |
| 岛是空的 | 管理台登录一次，或跑 `./configure.sh`；确认后端 `/api/admin/island/busy` 有数据 |
| 提示无法验证开发者 | 右键打开二进制，或重新 `./install.sh`（会清 quarantine） |
| Intel / M 芯片下打不开 | 换对应 arch 的 zip，不要混用 |

## 给发布者（有 Xcode 的人）

在仓库本机执行：

```bash
cd macos/AtollaIsland
./scripts/package-release.sh
```

生成 `dist/AtollaIsland-macos-<arch>-<日期>-<git>.zip`，上传到 GitHub Release 即可。  
包为 **未签名**；安装脚本已处理 quarantine，接收方一般无需证书。
**发布检查**：zip 内必须含 `AtollaIsland_AtollaIsland.bundle/`（与 `AtollaIsland` 同级），否则安装后会 fatal。
