import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyTeamEvent, emptyTeamState, parseTeamSSE } from './teamStreamAdapter.js'
import { mapAgentState, toTentacleAgents, permToApproval } from './mapAgents.js'
import { readUiMode, writeUiMode, UI_MODE_CLASSIC, UI_MODE_JELLY, UI_MODE_KEY } from './uiMode.js'

test('parseTeamSSE 拆帧并带 seq', () => {
  const buf = 'id: 3\ndata: {"type":"agent.status","agentId":"1","state":"working","currentTask":"x","seq":3}\n\npartial'
  const { events, rest, lastId } = parseTeamSSE(buf)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'agent.status')
  assert.equal(events[0].seq, 3)
  assert.equal(lastId, '3')
  assert.equal(rest, 'partial')
})

test('applyTeamEvent snapshot / approval / progress', () => {
  let s = emptyTeamState()
  s = applyTeamEvent(s, {
    type: 'snapshot',
    seq: 1,
    agents: [{ agentId: '7', state: 'idle', currentTask: '休息中', name: '前端' }],
    approvals: [],
  })
  assert.equal(s.agents['7'].state, 'idle')
  s = applyTeamEvent(s, {
    type: 'approval.pending',
    seq: 2,
    approvalId: 'a1',
    agentId: '7',
    title: '要重跑吗？',
    actions: [{ k: 'rerun', l: '重跑', pri: 1 }, { k: 'skip', l: '跳过' }],
  })
  assert.equal(s.approvals.a1.title, '要重跑吗？')
  assert.equal(s.agents['7'].state, 'waiting')
  s = applyTeamEvent(s, {
    type: 'task.progress',
    seq: 3,
    agentId: '7',
    progress: 0.5,
    message: '跑集成',
  })
  assert.equal(s.agents['7'].state, 'working')
  assert.match(s.agents['7'].currentTask, /50%/)
})

test('mapAgentState 与触手映射', () => {
  assert.equal(mapAgentState({ status: 'running' }), 'working')
  assert.equal(mapAgentState({ status: 'idle' }, { hasPendingApproval: true }), 'waiting')
  const tents = toTentacleAgents([
    { id: 1, name: 'A', status: 'idle' },
    { id: 2, name: 'B', status: 'running' },
  ], { pendingApprovals: [{ agentId: '1' }] })
  assert.equal(tents[0].s, 'wait')
  assert.equal(tents[1].s, 'working')
  assert.equal(tents.length, 2)
})

test('permToApproval 最多两个按钮', () => {
  const ap = permToApproval({
    request_id: 'r1',
    agentId: 9,
    tool_name: 'Bash',
    summary: 'rm -rf',
    meaning: '危险删除',
  })
  assert.equal(ap.actions.length, 2)
  assert.equal(ap.agentId, '9')
})

test('uiMode 默认经典并持久化', () => {
  const prev = globalThis.localStorage
  const store = {}
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
  }
  try {
    delete store[UI_MODE_KEY]
    assert.equal(readUiMode(), UI_MODE_CLASSIC)
    writeUiMode(UI_MODE_JELLY)
    assert.equal(readUiMode(), UI_MODE_JELLY)
    writeUiMode('nope')
    assert.equal(readUiMode(), UI_MODE_CLASSIC)
  } finally {
    globalThis.localStorage = prev
  }
})
