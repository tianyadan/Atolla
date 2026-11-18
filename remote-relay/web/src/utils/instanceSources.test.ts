import { describe, expect, it } from 'vitest'
import { mergeInstanceSources } from './instanceSources'

describe('mergeInstanceSources', () => {
  it('keeps cloud instances and marks a paired local instance as LAN-preferred', () => {
    const rows = mergeInstanceSources(
      [
        { instance_id: 'cloud-only', display_name: 'Cloud Mac' },
        { instance_id: 'same-mac', display_name: 'Cloud Name' },
      ],
      [{ instance_id: 'same-mac', display_name: 'Office Mac' }],
    )

    expect(rows).toEqual([
      { instance_id: 'cloud-only', display_name: 'Cloud Mac', connection: 'server' },
      { instance_id: 'same-mac', display_name: 'Office Mac', connection: 'lan' },
    ])
  })
})
