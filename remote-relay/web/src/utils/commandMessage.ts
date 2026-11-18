/** Parsed command bubble fields (aligned with PC ManagedAgents) */
export type ParsedCommand = {
  command: string
  decision: string
  risk: 'low' | 'mid' | 'high' | string
  meaning: string
  by: string
  note: string
}

/** Risk pill label */
export function riskText(risk: string): string {
  return ({ low: '无害', mid: '需注意', high: '高风险' } as Record<string, string>)[risk] || '需注意'
}

/** Who approved label */
export function byLabel(by: string): string {
  const b = String(by || '').toLowerCase()
  if (b === 'auto' || b === 'ai') return '自动审核'
  if (b === 'user' || b === 'manual') return '手动批准'
  if (b === 'session') return '会话授权'
  return by || ''
}

/** 命令风险条文案：meaning / by / note 去重，避免 JEV 提示重复两遍 */
export function formatCmdRiskCaption(parsed: ParsedCommand): string {
  const meaning = String(parsed.meaning || '').trim()
  const note = String(parsed.note || '').trim()
  const by = byLabel(parsed.by).trim()
  const base = meaning || `风险等级：${riskText(parsed.risk)}`
  const parts: string[] = [base]

  const alreadyHas = (s: string) =>
    parts.some((p) => p === s || p.includes(s) || s.includes(p))

  if (by && !alreadyHas(by)) parts.push(by)
  // note 与 meaning 相同或互相包含时跳过（常见：两边都是 JEV/自动审核说明）
  if (note && !alreadyHas(note)) parts.push(note)

  return parts.join(' · ')
}

/**
 * Extract command display fields from mirror message.
 * Prefers payload (from Mac sync); falls back to JSON content.
 */
export function parseCommandMessage(
  content: string | null | undefined,
  payload?: Record<string, unknown> | null,
  status?: string | null,
): ParsedCommand {
  const p = payload || {}
  let command = String(p.command || '').trim()
  let decision = String(p.decision || '').trim()
  let risk = String(p.risk || '').trim()
  let meaning = String(p.meaning || '').trim()
  let by = String(p.by || '').trim()
  let note = String(p.note || '').trim()

  const raw = String(content || '').trim()
  if ((!command || !decision) && raw.startsWith('{')) {
    try {
      const cmd = JSON.parse(raw) as Record<string, unknown>
      if (!command && typeof cmd.command === 'string') command = cmd.command
      if (!decision && typeof cmd.decision === 'string') decision = cmd.decision
      if (!risk && typeof cmd.risk === 'string') risk = cmd.risk
      if (!meaning && typeof cmd.meaning === 'string') meaning = cmd.meaning
      if (!by && typeof cmd.by === 'string') by = cmd.by
      if (!note && typeof cmd.note === 'string') note = cmd.note
    } catch {
      /* plain */
    }
  }

  if (!command) command = raw
  const st = String(status || p.status || '').toLowerCase()
  if (!decision && st === 'denied') decision = 'deny'
  if (!risk) risk = decision === 'deny' ? 'high' : 'mid'

  return { command, decision, risk, meaning, by, note }
}
