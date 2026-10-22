import { describe, expect, it } from 'vitest'
import {
  assignJellyColor,
  jellyStateFromAgent,
  resolveJellyColor,
  resolveMirrorJellyColor,
} from './jellyColor'

describe('jellyColor', () => {
  it('assignJellyColor 按 id 稳定轮转', () => {
    expect(assignJellyColor(0)).toBe('orange')
    expect(assignJellyColor(2)).toBe('blue')
    expect(assignJellyColor(6)).toBe('orange')
  })

  it('resolveJellyColor 优先 API 字段', () => {
    expect(resolveJellyColor({ id: 1, jelly_color: 'red' })).toBe('red')
    expect(resolveJellyColor({ id: 2 })).toBe('blue')
  })

  it('resolveMirrorJellyColor 读 payload', () => {
    expect(
      resolveMirrorJellyColor({
        agent_id: '9',
        payload: { jelly_color: 'purple' },
      }),
    ).toBe('purple')
  })

  it('jellyStateFromAgent 映射忙闲', () => {
    expect(jellyStateFromAgent({ status: 'running' })).toBe('working')
    expect(jellyStateFromAgent({ status: 'idle' }, { streaming: true })).toBe('typing')
    expect(jellyStateFromAgent({ status: 'error' })).toBe('error')
  })
})
