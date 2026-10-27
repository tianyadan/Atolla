/**
 * 三个工作引擎的安装命令（版本锁定）。
 * 版本取自当前已验证可跑通 Atolla 的本机 CLI，升级需同步改这里并回归。
 */
export const ENGINE_CLI_LOCK = {
  claude: '2.1.185',
  codex: '0.153.4',
  /** Cursor Agent CLI（命令名 agent），对应 downloads.cursor.com/lab/<ver>/… */
  cursor: '2026.10.22-27dcf5f',
}

/** 按锁定版本安装 Cursor Agent（不走会漂移的 cursor.com/install 脚本） */
function cursorAgentInstallCommand(version) {
  // 单行可复制；已有同版本目录则先改名归档，避免覆盖丢历史
  return [
    `VER='${version}'`,
    `OS=$(uname -s)`,
    `case "$OS" in Darwin) OS=darwin;; Linux) OS=linux;; *) echo "unsupported OS: $OS" >&2; exit 1;; esac`,
    `ARCH=$(uname -m)`,
    `case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "unsupported arch: $ARCH" >&2; exit 1;; esac`,
    `DEST="$HOME/.local/share/cursor-agent/versions/$VER"`,
    `STAGE="$DEST.stage.$$"`,
    `mkdir -p "$STAGE" "$HOME/.local/bin"`,
    `curl -fSL "https://downloads.cursor.com/lab/$VER/$OS/$ARCH/agent-cli-package.tar.gz" | tar --strip-components=1 -xzf - -C "$STAGE"`,
    `if [ -d "$DEST" ]; then mv "$DEST" "$DEST.bak.$(date +%s)"; fi`,
    `mv "$STAGE" "$DEST"`,
    `ln -sfn "$DEST/cursor-agent" "$HOME/.local/bin/agent"`,
    `ln -sfn "$DEST/cursor-agent" "$HOME/.local/bin/cursor-agent"`,
    `echo "Installed Cursor Agent $VER → ~/.local/bin/agent"`,
    `echo "若提示找不到 agent：把 ~/.local/bin 加入 PATH 后重开终端"`,
  ].join(' && ')
}

/** 三个工作引擎的安装命令。Cursor 官方不提供 npm 包，使用版本锁定下载。 */
export const ENGINE_CATALOG = [
  {
    id: 'claude',
    name: 'Claude',
    bin: 'claude',
    version: ENGINE_CLI_LOCK.claude,
    blurb: 'Anthropic Claude Code',
    npm: `npm install -g @anthropic-ai/claude-code@${ENGINE_CLI_LOCK.claude}`,
    npmCn: `npm install -g @anthropic-ai/claude-code@${ENGINE_CLI_LOCK.claude} --registry=https://registry.npmmirror.com`,
  },
  {
    id: 'codex',
    name: 'Codex',
    bin: 'codex',
    version: ENGINE_CLI_LOCK.codex,
    blurb: 'OpenAI Codex CLI',
    npm: `npm install -g @openai/codex@${ENGINE_CLI_LOCK.codex}`,
    npmCn: `npm install -g @openai/codex@${ENGINE_CLI_LOCK.codex} --registry=https://registry.npmmirror.com`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bin: 'agent',
    version: ENGINE_CLI_LOCK.cursor,
    blurb: 'Cursor Agent CLI',
    npm: cursorAgentInstallCommand(ENGINE_CLI_LOCK.cursor),
    npmCn: cursorAgentInstallCommand(ENGINE_CLI_LOCK.cursor),
    note: `Cursor Agent 锁定版本 ${ENGINE_CLI_LOCK.cursor}（命令名为 agent）。不经过 npm；勾选镜像不会改这条命令。安装后请确认 ~/.local/bin 在 PATH 中。`,
  },
]

/** 按是否使用国内 npm 镜像返回可复制的安装命令。 */
export function installCommand(engine, chinaMirror) {
  if (!engine) return ''
  return chinaMirror ? engine.npmCn : engine.npm
}

/** 复制文本。剪贴板不可用时退回选区复制。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** 拉取本机引擎检测与是否还需注册管理员。 */
export async function fetchSetupStatus() {
  const res = await fetch('/api/setup/status')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `检查失败(${res.status})`)
  const byId = {}
  for (const item of data.engines || []) byId[item.id] = item
  return {
    needsRegister: !!data.needs_register,
    engines: ENGINE_CATALOG.map((meta) => ({
      ...meta,
      installed: !!byId[meta.id]?.installed,
      path: byId[meta.id]?.path || '',
    })),
  }
}
