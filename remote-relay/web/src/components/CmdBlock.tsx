import { useState, type MouseEvent } from 'react'
import { byLabel, parseCommandMessage, riskText } from '../utils/commandMessage'

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

  /** Copy command text */
  async function copy(e: MouseEvent) {
    e.stopPropagation()
    const text = parsed.command || ''
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
        <code className="cmd-preview">{previewCmd(parsed.command || '')}</code>
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
        <code>{parsed.command}</code>
        <button type="button" className="cmd-copy" onClick={(e) => void copy(e)} title="复制命令">
          复制
        </button>
      </div>
      {(parsed.meaning || parsed.risk || parsed.by || parsed.note) && (
        <div className="cmd-meaning-bar">
          <span className="cmd-risk-dot">{riskText(risk)}</span>
          <span>
            {parsed.meaning || `风险等级：${riskText(risk)}`}
            {parsed.by ? ` · ${byLabel(parsed.by)}` : ''}
            {parsed.note ? ` · ${parsed.note}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
