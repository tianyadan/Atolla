import { useState, type MouseEvent } from 'react'
import { copyToClipboard } from '../utils/clipboard'
import {
  formatCmdRiskCaption,
  parseCommandMessage,
  riskText,
} from '../utils/commandMessage'

type Props = {
  content: string | null | undefined
  payload?: Record<string, unknown> | null
  /** 审批弹窗等场景需要默认展开；对话记录默认折叠 */
  startExpanded?: boolean
}

/** 截断命令预览，折叠态单行展示 */
function previewCmd(text: string, max = 72): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max)}…`
}

/** Command block with PC-like risk coloring；对话内默认折叠 */
export function CmdBlock({ content, payload, startExpanded = false }: Props) {
  const parsed = parseCommandMessage(content, payload)
  const denied = parsed.decision === 'deny'
  const risk = parsed.risk || (denied ? 'high' : 'mid')
  const [open, setOpen] = useState(startExpanded)
  const [copied, setCopied] = useState(false)

  /** 解析出的命令正文（payload / JSON content） */
  const commandText = (() => {
    const fromParsed = String(parsed.command || '').trim()
    if (fromParsed && !fromParsed.startsWith('{')) return fromParsed
    const raw = String(content || '').trim()
    if (raw.startsWith('{')) {
      try {
        const cmd = JSON.parse(raw) as { command?: string }
        if (typeof cmd.command === 'string' && cmd.command.trim()) return cmd.command.trim()
      } catch {
        /* plain */
      }
    }
    return fromParsed || raw
  })()

  /** Copy command text + 「已复制」反馈 */
  async function copy(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!commandText) return
    const ok = await copyToClipboard(commandText)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const riskCaption = formatCmdRiskCaption(parsed)
  const showRiskBar = !!(parsed.meaning || parsed.risk || parsed.by || parsed.note)

  if (!open) {
    return (
      <button
        type="button"
        className={`cmd-block cmd-block-collapsed risk-${risk}${denied ? ' denied' : ''}`}
        onClick={() => setOpen(true)}
        aria-expanded={false}
        title="点击展开命令"
      >
        <span className="cmd-fold-tri" aria-hidden>
          ▶
        </span>
        <code className="cmd-preview">{previewCmd(commandText)}</code>
        <span className="cmd-risk-dot">{riskText(risk)}</span>
      </button>
    )
  }

  return (
    <div className={`cmd-block risk-${risk}${denied ? ' denied' : ''}`}>
      <button
        type="button"
        className="cmd-fold-head"
        onClick={() => setOpen(false)}
        aria-expanded={true}
        title="点击折叠"
      >
        <span className="cmd-fold-tri" aria-hidden>
          ▼
        </span>
        <span className="cmd-fold-hint">命令</span>
      </button>
      <div className="cmd-block-main">
        <code>{commandText}</code>
        <button
          type="button"
          className={`cmd-copy${copied ? ' is-copied' : ''}`}
          onClick={(e) => void copy(e)}
          title="复制命令"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {showRiskBar ? (
        <div className="cmd-meaning-bar">
          <span className="cmd-risk-dot">{riskText(risk)}</span>
          <span>{riskCaption}</span>
        </div>
      ) : null}
    </div>
  )
}
