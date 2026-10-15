import {
  contextRingFillRatio,
  contextRingLabel,
  type AgentContextUsage,
} from '../utils/agentStatus'

type Props = {
  usage: AgentContextUsage
}

/** Compact PC-like context ring; stroke capped at 100%, label never shows overflow % */
export function ContextRing({ usage }: Props) {
  const size = 22
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const fill = contextRingFillRatio(usage)
  const dash = c * fill
  const pctNum = Math.round(usage.pct)
  const anomaly = !!usage.anomaly || usage.pct > 100
  const label = contextRingLabel(usage)
  const title =
    usage.window > 0
      ? `${usage.estimated ? '约 ' : ''}${pctNum}%（${usage.used}/${usage.window}）${
          anomaly ? '\n占用超过窗口（与 PC 一致，环内显示 !）' : ''
        }`
      : '上下文用量未知'

  return (
    <div
      className={`ctx-ring${usage.estimated ? ' is-estimated' : ''}${anomaly ? ' is-anomaly' : ''}`}
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
