import { describe, expect, it } from 'vitest'
import type { PublicMirrorAgent, PublicMirrorPermission } from './api'
import {
  buildIslandEvents,
  islandEventDeepLink,
  selectIslandPresentation,
  type IslandEvent,
} from './islandEvents'

function agent(
  id: string,
  status: string,
  payload: Record<string, unknown> = {},
): PublicMirrorAgent {
  return {
    agent_id: id,
    display_name: `员工-${id}`,
    engine: 'agent',
    status,
    payload,
    synced_at: 1_700_000_000_000,
  }
}

function approval(requestId: string, agentId: string): PublicMirrorPermission {
  return {
    request_id: requestId,
    agent_id: agentId,
    conversation_id: 9,
    tool_name: 'Bash',
    summary: '执行命令',
    note: null,
    meaning: null,
    risk: 'medium',
    created_at: '2026-10-23T08:00:00.000Z',
    deadline: '2099-10-23T08:00:00.000Z',
    synced_at: 1_700_000_001_000,
  }
}

describe('island event aggregation', () => {
  it('uses exact error > approval > running > completed priority', () => {
    const events: IslandEvent[] = [
      { id: 'completed:1', type: 'completed', instanceId: 'i', agentId: '1', agentName: '1', department: 'D', occurredAt: 4 },
      { id: 'running:2', type: 'running', instanceId: 'i', agentId: '2', agentName: '2', department: 'D', occurredAt: 3 },
      { id: 'approval:r', type: 'approval', instanceId: 'i', agentId: '3', agentName: '3', department: 'D', requestId: 'r', occurredAt: 2 },
      { id: 'error:4', type: 'error', instanceId: 'i', agentId: '4', agentName: '4', department: 'D', occurredAt: 1 },
    ]
    expect(selectIslandPresentation(events)).toMatchObject({ activeKind: 'error', count: 1 })
    expect(selectIslandPresentation(events.filter((e) => e.type !== 'error'))).toMatchObject({ activeKind: 'approval', count: 1 })
    expect(selectIslandPresentation(events.filter((e) => !['error', 'approval'].includes(e.type)))).toMatchObject({ activeKind: 'running', count: 1 })
  })

  it('builds one terminal event per agent and preserves the latest snapshot fields', () => {
    const events = buildIslandEvents('mac 1', [agent('a/1', 'idle', {
      folder_name: '研发部',
      task_unread_kind: 'completed',
      task_unread_at: 1_700_000_010,
      task_unread_duration_ms: 4567,
      task_unread_summary: '完成',
    })], [])
    expect(events).toEqual([expect.objectContaining({
      id: 'completed:a/1',
      type: 'completed',
      department: '研发部',
      occurredAt: 1_700_000_010_000,
      durationMs: 4567,
      summary: '完成',
    })])
  })

  it('keeps an unread error ahead of the same agent new running state', () => {
    const events = buildIslandEvents('mac', [agent('a', 'running', {
      task_unread_kind: 'error',
      task_unread_at: 1_700_000_020,
      task_unread_duration_ms: 100,
      task_unread_summary: '旧错误',
      run_started_at: 1_700_000_030,
    })], [])
    expect(events.map((e) => e.type).sort()).toEqual(['error', 'running'])
    expect(selectIslandPresentation(events).activeKind).toBe('error')
  })

  it('keys approvals by request id and filters orphan approvals', () => {
    const events = buildIslandEvents('mac', [agent('a', 'idle')], [
      approval('req-1', 'a'),
      approval('req-orphan', 'missing'),
    ])
    expect(events).toEqual([expect.objectContaining({ id: 'approval:req-1', requestId: 'req-1' })])
  })

  it('limits details to five while retaining the full category count', () => {
    const agents = Array.from({ length: 7 }, (_, i) => agent(String(i), 'running', { run_started_at: 1_700_000_000 + i }))
    const presentation = selectIslandPresentation(buildIslandEvents('mac', agents, []), 5)
    expect(presentation.activeKind).toBe('running')
    expect(presentation.count).toBe(7)
    expect(presentation.items).toHaveLength(5)
    expect(presentation.items[0].agentId).toBe('6')
  })

  it('does not invent terminal events from malformed legacy payloads', () => {
    const events = buildIslandEvents('mac', [agent('a', 'running', {
      task_unread: true,
      task_unread_kind: 'done',
      task_unread_at: 'not-a-time',
      run_started_at: 1_700_000_030,
    })], [])
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('running')
  })

  it('percent-encodes agent and approval deep links', () => {
    const base: IslandEvent = {
      id: 'error:a/b', type: 'error', instanceId: 'mac office', agentId: 'a/b',
      agentName: 'A', department: '研发', occurredAt: 1,
    }
    expect(islandEventDeepLink(base)).toBe('atolla://agent/mac%20office/a%2Fb/chat')
    expect(islandEventDeepLink({ ...base, type: 'approval', requestId: 'r/1' })).toBe(
      'atolla://approval/mac%20office/a%2Fb/r%2F1',
    )
  })
})
