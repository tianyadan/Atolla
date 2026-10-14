import { byLabel, parseCommandMessage, riskText } from '../utils/commandMessage'

type Props = {
  content: string | null | undefined
  payload?: Record<string, unknown> | null
}

/** Command block with PC-like risk coloring */
export function CmdBlock({ content, payload }: Props) {
  const parsed = parseCommandMessage(content, payload)
  const denied = parsed.decision === 'deny'
  const risk = parsed.risk || (denied ? 'high' : 'mid')

  /** Copy command text */
  async function copy() {
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

  return (
    <div className={`cmd-block risk-${risk}${denied ? ' denied' : ''}`}>
      <div className="cmd-block-main">
        <code>{parsed.command}</code>
        <button type="button" className="cmd-copy" onClick={() => void copy()} title="复制命令">
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
