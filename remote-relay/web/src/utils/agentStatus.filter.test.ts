import { describe, expect, it } from 'vitest'
import { filterAgentGroupsByQuery, listBusyAgents, type AgentFolderGroup } from './agentStatus'
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
