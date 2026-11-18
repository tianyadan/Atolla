import { describe, expect, it } from 'vitest'
import {
  assignJellyColor,
  jellyStateFromAgent,
  jellyStateFromPhase,
  resolveJellyColor,
  resolveMirrorJellyColor,
} from './jellyColor'

describe('jellyColor', () => {
  it('assignJellyColor 按 id 稳定轮转（12 色）', () => {
    expect(assignJellyColor(0)).toBe('orange')
    expect(assignJellyColor(2)).toBe('blue')
    expect(assignJellyColor(6)).toBe('cyan')
    expect(assignJellyColor(11)).toBe('sky')
    expect(assignJellyColor(12)).toBe('orange')
  })

  it('resolveJellyColor 优先 API 字段', () => {
    expect(resolveJellyColor({ id: 1, jelly_color: 'red' })).toBe('red')
    expect(resolveJellyColor({ id: 1, jelly_color: 'lime' })).toBe('lime')
    expect(resolveJellyColor({ id: 2 })).toBe('blue')
    expect(resolveJellyColor({ id: 6 })).toBe('cyan')
  })

  it('resolveMirrorJellyColor 读 payload', () => {
    expect(
      resolveMirrorJellyColor({
        agent_id: '9',
        payload: { jelly_color: 'purple' },
      }),
    ).toBe('purple')
    expect(
      resolveMirrorJellyColor({
        agent_id: '9',
        payload: { jelly_color: 'sky' },
      }),
    ).toBe('sky')
  })

  it('jellyStateFromAgent 映射忙闲', () => {
    expect(jellyStateFromAgent({ status: 'running' })).toBe('working')
    expect(jellyStateFromAgent({ status: 'idle' }, { streaming: true })).toBe('typing')
    expect(jellyStateFromAgent({ status: 'error' })).toBe('error')
  })

  it('jellyStateFromPhase 映射思考和编码动作', () => {
    expect(jellyStateFromPhase('thinking')).toBe('ponder')
    expect(jellyStateFromPhase('tool_call')).toBe('coding')
    expect(jellyStateFromPhase('responding')).toBe('coding')
    expect(jellyStateFromPhase('waiting')).toBe('waiting')
    expect(jellyStateFromPhase('unknown', 'working')).toBe('working')
  })

  it('jellyStateFromAgent 优先消费镜像中的实时阶段', () => {
    expect(
      jellyStateFromAgent({ status: 'running', payload: { agent_phase: 'thinking' } }),
    ).toBe('ponder')
    expect(
      jellyStateFromAgent({ status: 'running', payload: { agent_phase: 'working' } }),
    ).toBe('coding')
  })
})
