import { describe, expect, it } from 'vitest'
import {
  agentRunStartedAt,
  filterAgentGroupsByQuery,
  formatBusyElapsed,
  listBusyAgents,
  listUnreadAgents,
  type AgentFolderGroup,
} from './agentStatus'
import type { PublicMirrorAgent } from '../api'

/** Build a minimal mirror agent for filter tests */
function agent(id: string, name: string, status: string = 'idle'): PublicMirrorAgent {
  return {
    agent_id: id,
    display_name: name,
    engine: 'claude',
    status,
    payload: {},
    synced_at: 1,
  }
}

const sample: AgentFolderGroup[] = [
  {
    key: 'root',
    title: '未入组',
    sort: 0,
    agents: [agent('a1', '张三'), agent('a2', '后端-李四')],
  },
  {
    key: 'f:1',
    title: '研发',
    sort: 1,
    agents: [agent('b1', '测试员')],
  },
]

describe('filterAgentGroupsByQuery', () => {
  it('returns all groups when query is empty or whitespace', () => {
    expect(filterAgentGroupsByQuery(sample, '')).toEqual(sample)
    expect(filterAgentGroupsByQuery(sample, '  ')).toEqual(sample)
  })

  it('filters by display_name case-insensitively and drops empty groups', () => {
    const out = filterAgentGroupsByQuery(sample, '李')
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('root')
    expect(out[0].agents.map((a) => a.agent_id)).toEqual(['a2'])
  })

  it('matches agent_id', () => {
    const out = filterAgentGroupsByQuery(sample, 'b1')
    expect(out).toHaveLength(1)
    expect(out[0].agents[0].display_name).toBe('测试员')
  })

  it('returns empty list when nothing matches', () => {
    expect(filterAgentGroupsByQuery(sample, '不存在')).toEqual([])
  })
})

describe('listBusyAgents', () => {
  const pool = [
    agent('a1', '张三', 'idle'),
    agent('a2', '李四', 'running'),
    agent('a3', '王五', 'waiting'),
    agent('a4', '后端-赵六', 'compressing'),
  ]

  it('returns only busy agents', () => {
    expect(listBusyAgents(pool).map((a) => a.agent_id)).toEqual(['a2', 'a3', 'a4'])
  })

  it('filters busy agents by name query', () => {
    expect(listBusyAgents(pool, '李').map((a) => a.agent_id)).toEqual(['a2'])
  })

  it('returns empty when no busy match', () => {
    expect(listBusyAgents(pool, '张')).toEqual([])
  })
})

describe('listUnreadAgents', () => {
  it('sorts by task_unread_at desc (earlier completion further back)', () => {
    const pool: PublicMirrorAgent[] = [
      {
        agent_id: 'old',
        display_name: '早完成',
        engine: 'claude',
        status: 'idle',
        payload: { task_unread: true, task_unread_at: 1000 },
        synced_at: 1,
      },
      {
        agent_id: 'new',
        display_name: '晚完成',
        engine: 'claude',
        status: 'idle',
        payload: { task_unread: true, task_unread_at: 2000 },
        synced_at: 1,
      },
      {
        agent_id: 'busy',
        display_name: '仍在忙',
        engine: 'claude',
        status: 'running',
        payload: { task_unread: true, task_unread_at: 3000 },
        synced_at: 1,
      },
    ]
    expect(listUnreadAgents(pool).map((a) => a.agent_id)).toEqual(['new', 'old'])
  })
})

describe('agent run timer', () => {
  it('repairs legacy local wall time parsed as UTC', () => {
    const nowSec = Date.parse('2026-10-27T03:27:10Z') / 1000
    const legacySec = Date.parse('2026-10-27T11:25:23Z') / 1000
    const startedAt = agentRunStartedAt(
      { run_started_at: legacySec },
      nowSec,
      -480,
    )
    expect(startedAt).toBe(Date.parse('2026-10-27T03:25:23Z') / 1000)
    expect(formatBusyElapsed(startedAt, nowSec)).toBe('1分47秒')
  })

  it('accepts unix milliseconds from mixed-version mirrors', () => {
    const nowSec = 1_800_000_000
    expect(agentRunStartedAt({ run_started_at: (nowSec - 12) * 1000 }, nowSec, 0)).toBe(nowSec - 12)
  })
})
