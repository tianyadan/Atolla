/** 三个工作引擎的安装命令。Cursor 官方不提供 npm 包，使用安装脚本。 */
export const ENGINE_CATALOG = [
  {
    id: 'claude',
    name: 'Claude',
    bin: 'claude',
    blurb: 'Anthropic Claude Code',
    npm: 'npm install -g @anthropic-ai/claude-code',
    npmCn: 'npm install -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com',
  },
  {
    id: 'codex',
    name: 'Codex',
    bin: 'codex',
    blurb: 'OpenAI Codex CLI',
    npm: 'npm install -g @openai/codex',
    npmCn: 'npm install -g @openai/codex --registry=https://registry.npmmirror.com',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bin: 'agent',
    blurb: 'Cursor Agent CLI',
    npm: 'curl https://cursor.com/install -fsS | bash',
    npmCn: 'curl https://cursor.com/install -fsS | bash',
    note: 'Cursor 官方通过安装脚本提供 CLI（命令名为 agent），不经过 npm。勾选镜像不会改这条命令。',
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
