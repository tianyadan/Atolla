import {
  contextRingFillRatio,
  contextRingLabel,
  contextUsageKnown,
  type AgentContextUsage,
} from '../utils/agentStatus'

type Props = {
  usage: AgentContextUsage
}

/** Compact PC-like context ring; hide entirely when occupancy unknown */
export function ContextRing({ usage }: Props) {
  if (!contextUsageKnown(usage)) return null

  const size = 22
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const fill = contextRingFillRatio(usage)
  const dash = c * fill
  const pctNum = Math.round(Math.min(100, Math.max(0, usage.pct)))
  const over = usage.pct > 100 || !!usage.anomaly
  const label = contextRingLabel(usage)
  const title = `${usage.estimated ? '约 ' : ''}${pctNum}%（${usage.used}/${usage.window}）${
    over ? '\n占用已按窗口封顶展示' : ''
  }`

  return (
    <div
      className={`ctx-ring${usage.estimated ? ' is-estimated' : ''}${over ? ' is-anomaly' : ''}`}
      title={title}
      aria-label={title}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ctx-ring-label">{label}</span>
    </div>
  )
}
