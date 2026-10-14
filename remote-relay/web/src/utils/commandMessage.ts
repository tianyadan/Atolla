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
