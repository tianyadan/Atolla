import { describe, expect, it } from 'vitest'
import { formatCmdRiskCaption, type ParsedCommand } from './commandMessage'

function base(partial: Partial<ParsedCommand>): ParsedCommand {
  return {
    command: 'ls',
    decision: 'allow',
    risk: 'low',
    meaning: '',
    by: '',
    note: '',
    ...partial,
  }
}

describe('formatCmdRiskCaption', () => {
  it('dedupes identical meaning and note', () => {
    const caption = formatCmdRiskCaption(
      base({
        meaning: 'JEV 审核：无害命令',
        note: 'JEV 审核：无害命令',
        by: 'ai',
      }),
    )
    expect(caption).toBe('JEV 审核：无害命令 · 自动审核')
  })

  it('skips by when already in meaning', () => {
    const caption = formatCmdRiskCaption(
      base({
        meaning: '已由自动审核放行',
        by: 'auto',
      }),
    )
    expect(caption).toBe('已由自动审核放行')
  })
})
