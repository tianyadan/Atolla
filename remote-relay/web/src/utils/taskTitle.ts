import type { ActiveTaskPlanDTO } from '../api'

const MAX_CHARS = 8

/** Count unicode chars (CJK-safe) and hard-cap length */
export function clampTaskChars(raw: string, max = MAX_CHARS): string {
  const chars = Array.from(String(raw || '').replace(/\s+/g, ' ').trim())
  if (!chars.length) return ''
  if (chars.length <= max) return chars.join('')
  return chars.slice(0, max).join('')
}

/**
 * Build a short progress title from AI plan fields — never the raw user question.
 * Prefer current step / plan message; fall back to phase labels.
 */
export function resolveProgressTaskTitle(
  plan: ActiveTaskPlanDTO | null | undefined,
  hasRunningTask: boolean,
): string {
  if (!plan && !hasRunningTask) return '暂无任务'

  const stepIdx = Math.max(0, Math.round(Number(plan?.current_step) || 1) - 1)
  const stepTitle = String(plan?.step_items?.[stepIdx]?.title || '').trim()
  const planMsg = String(plan?.message || '').trim()
  const planName = String(plan?.task_name || '').trim()

  // Prefer AI step / short plan labels; reject very long names (likely user paste)
  const candidates = [
    stepTitle,
    planMsg,
    planName && Array.from(planName).length <= 16 ? planName : '',
  ].filter(Boolean)

  for (const c of candidates) {
    const short = clampTaskChars(c, MAX_CHARS)
    if (short) return short
  }

  const phase = String(plan?.phase || '').toLowerCase()
  if (phase === 'planning') return '规划中'
  if (phase === 'awaiting_confirm') return '待确认'
  if (phase === 'paused') return '已暂停'
  if (hasRunningTask || phase === 'running') return '执行中'
  return '任务进行'
}
