import { describe, expect, it } from 'vitest'
import { formatConnectionRoute } from './connectionDisplay'

describe('connection route display', () => {
  it('prioritizes an active LAN route in the settings menu', () => {
    expect(formatConnectionRoute({ channel: 'lan', failureCount: 0 }, 'en')).toEqual({
      label: 'Local network direct',
      tone: 'success',
    })
  })

  it('shows the relay server when LAN is not the active route', () => {
    expect(formatConnectionRoute({ channel: 'cloud', failureCount: 2 }, 'en')).toEqual({
      label: 'Server relay',
      tone: 'neutral',
    })
  })

  it('marks an unavailable route as an error', () => {
    expect(formatConnectionRoute({ channel: 'unavailable', failureCount: 3 }, 'en')).toEqual({
      label: 'Unavailable',
      tone: 'danger',
    })
  })

  it('keeps the Chinese labels when Chinese is selected', () => {
    expect(formatConnectionRoute({ channel: 'lan', failureCount: 0 }, 'zh-CN')).toEqual({
      label: '局域网直连',
      tone: 'success',
    })
  })
})
