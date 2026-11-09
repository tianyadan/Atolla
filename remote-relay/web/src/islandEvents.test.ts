import { describe, expect, it } from 'vitest'
import type { PublicMirrorAgent, PublicMirrorPermission } from './api'
import {
  buildIslandEvents,
  formatWorkStatus,
  islandAgentsListDeepLink,
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
  it('uses error > approval > task_plan > running priority (completed off-island)', () => {
    const events: IslandEvent[] = [
      { id: 'task_plan:1', type: 'task_plan', instanceId: 'i', agentId: '1', agentName: '1', department: 'D', occurredAt: 4 },
      { id: 'approval:r', type: 'approval', instanceId: 'i', agentId: '3', agentName: '3', department: 'D', requestId: 'r', occurredAt: 2 },
      { id: 'error:4', type: 'error', instanceId: 'i', agentId: '4', agentName: '4', department: 'D', occurredAt: 1 },
      { id: 'running:2', type: 'running', instanceId: 'i', agentId: '2', agentName: '2', department: 'D', occurredAt: 3 },
    ]
    expect(selectIslandPresentation(events)).toMatchObject({ activeKind: 'error', count: 1 })
    expect(selectIslandPresentation(events.filter((e) => e.type !== 'error'))).toMatchObject({
      activeKind: 'approval',
      count: 1,
    })
    expect(
      selectIslandPresentation(events.filter((e) => !['error', 'approval'].includes(e.type))),
    ).toMatchObject({ activeKind: 'task_plan', presentation: 'task_plan', count: 1 })
    // 仅剩 running 时也可上岛（前台 Live Activity）
    expect(
      selectIslandPresentation(events.filter((e) => e.type === 'running')),
    ).toMatchObject({ activeKind: 'running', count: 1, presentation: 'list' })
  })

  it('does not put completed unread on the island', () => {
    const events = buildIslandEvents('mac 1', [agent('a/1', 'idle', {
      folder_name: '研发部',
      task_unread_kind: 'completed',
      task_unread_at: 1_700_000_010,
      task_unread_duration_ms: 4567,
      task_unread_summary: '完成',
    })], [])
    expect(events).toEqual([])
  })

  it('keeps unread error above plain running for the same agent', () => {
    const events = buildIslandEvents('mac', [agent('a', 'running', {
      task_unread_kind: 'error',
      task_unread_at: 1_700_000_020,
      task_unread_duration_ms: 100,
      task_unread_summary: '旧错误',
      run_started_at: 1_700_000_030,
    })], [])
    expect(events.map((e) => e.type)).toEqual(['error', 'running'])
    expect(selectIslandPresentation(events).activeKind).toBe('error')
  })

  it('keys approvals by request id and filters orphan approvals', () => {
    const events = buildIslandEvents('mac', [agent('a', 'idle')], [
      approval('req-1', 'a'),
      approval('req-orphan', 'missing'),
    ])
    expect(events).toEqual([
      expect.objectContaining({
        id: 'approval:req-1',
        requestId: 'req-1',
        expiresAt: Date.parse('2099-10-23T08:00:00.000Z'),
      }),
    ])
  })

  it('orders approvals by soonest deadline for island countdown', () => {
    const later = approval('later', 'a')
    const sooner: PublicMirrorPermission = {
      ...approval('sooner', 'a'),
      deadline: '2099-10-23T07:00:00.000Z',
    }
    const presentation = selectIslandPresentation(
      buildIslandEvents('mac', [agent('a', 'idle')], [later, sooner]),
    )
    expect(presentation.activeKind).toBe('approval')
    expect(presentation.items.map((i) => i.requestId)).toEqual(['sooner', 'later'])
  })

  it('surfaces plain running agents without task plan (list mode, capped)', () => {
    const agents = Array.from({ length: 7 }, (_, i) =>
      agent(String(i), 'running', { run_started_at: 1_700_000_000 + i }),
    )
    const presentation = selectIslandPresentation(buildIslandEvents('mac', agents, []), 5)
    expect(presentation.activeKind).toBe('running')
    expect(presentation.presentation).toBe('list')
    expect(presentation.count).toBe(7)
    expect(presentation.items).toHaveLength(5)
  })

  it('does not invent terminal events from malformed legacy payloads', () => {
    const events = buildIslandEvents('mac', [agent('a', 'running', {
      task_unread: true,
      task_unread_kind: 'done',
      task_unread_at: 'not-a-time',
      run_started_at: 1_700_000_030,
    })], [])
    // 畸形终态不上岛，但忙碌 running 仍可上岛
    expect(events.map((e) => e.type)).toEqual(['running'])
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
    expect(islandAgentsListDeepLink('mac office')).toBe('atolla://agents/mac%20office')
  })

  it('formats live phase/activity into short work status', () => {
    expect(formatWorkStatus({ activity_summary: '正在执行 git status' })).toBe('正在执行 git status')
    expect(formatWorkStatus({ activity_tool: 'Bash' })).toBe('正在调用 Bash')
    expect(formatWorkStatus({ agent_phase: 'thinking' })).toBe('正在思考')
    expect(formatWorkStatus({ agent_phase: 'working' })).toBe('正在工作')
  })

  it('prefers task_plan focus over other running agents', () => {
    const agents = [
      agent('1', 'running', {
        task_plan_enabled: true,
        agent_phase: 'working',
        activity_summary: '正在调用 Bash',
        run_started_at: 1_700_000_040,
        task_plan: {
          phase: 'running',
          progress: 40,
          message: '实现灵动岛进度条',
          current_step: 1,
          total_count: 4,
          task_name: '大任务',
        },
      }),
      agent('2', 'running', { run_started_at: 1_700_000_050 }),
    ]
    const events = buildIslandEvents('mac', agents, [])
    expect(events.map((e) => e.type)).toEqual(['task_plan', 'running'])
    const presentation = selectIslandPresentation(events)
    expect(presentation).toMatchObject({
      activeKind: 'task_plan',
      presentation: 'task_plan',
      count: 1,
    })
    expect(presentation.items[0]).toMatchObject({
      agentId: '1',
      workStatus: '实现灵动岛进度条',
      taskPlan: {
        progress: 40,
        currentStep: 1,
        totalCount: 4,
        message: '实现灵动岛进度条',
      },
    })
  })

  it('surfaces awaiting_confirm task plan even when agent is idle', () => {
    const events = buildIslandEvents('mac', [agent('1', 'idle', {
      task_plan_enabled: true,
      task_plan: {
        phase: 'awaiting_confirm',
        progress: 2,
        message: '待确认',
        total_count: 4,
        task_name: '大任务',
      },
    })], [])
    expect(selectIslandPresentation(events)).toMatchObject({
      activeKind: 'task_plan',
      presentation: 'task_plan',
    })
    expect(events[0].taskPlan?.phase).toBe('awaiting_confirm')
  })

  it('keeps error and approval ahead of task_plan focus', () => {
    const events = buildIslandEvents('mac', [
      agent('1', 'running', {
        task_plan_enabled: true,
        task_plan: { phase: 'running', progress: 20, message: '步骤 A', total_count: 3 },
        task_unread_kind: 'error',
        task_unread_at: 1_700_000_020,
        task_unread_summary: '失败',
      }),
    ], [approval('req', '1')])
    expect(selectIslandPresentation(events).activeKind).toBe('error')
    expect(
      selectIslandPresentation(events.filter((e) => e.type !== 'error')).activeKind,
    ).toBe('approval')
  })

  it('falls back to plain running when task plan mode is disabled', () => {
    const events = buildIslandEvents('mac', [agent('1', 'running', {
      task_plan_enabled: false,
      task_plan: { phase: 'running', progress: 50, message: '不应展示', total_count: 2 },
      agent_phase: 'thinking',
    })], [])
    expect(events.map((e) => e.type)).toEqual(['running'])
    expect(selectIslandPresentation(events).activeKind).toBe('running')
    expect(events[0].workStatus).toBe('正在思考')
  })
})
