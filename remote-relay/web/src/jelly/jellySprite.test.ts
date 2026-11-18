import { describe, expect, it } from 'vitest'
import { JELLY_ACTION_ROWS, jellyActionRow } from './jellySprite'

describe('jellySprite', () => {
  it('v3 精灵表为思考和编码动作保留独立行', () => {
    expect(JELLY_ACTION_ROWS).toBe(9)
    expect(jellyActionRow('ponder')).toBe(7)
    expect(jellyActionRow('coding')).toBe(8)
  })
})
