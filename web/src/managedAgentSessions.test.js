import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearAgentSession,
  getAgentSession,
  startAgentCelebration,
} from './managedAgentSessions.js'

test('任务成功后庆祝五秒的计时逻辑可独立结束', async () => {
  const agentId = 987_654
  clearAgentSession(agentId)
  startAgentCelebration(agentId, 20)
  assert.equal(getAgentSession(agentId).agentPhase, 'celebrate')
  assert.ok(getAgentSession(agentId).celebrationEndsAt > Date.now())

  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(getAgentSession(agentId).agentPhase, '')
  assert.equal(getAgentSession(agentId).celebrationEndsAt, 0)
  clearAgentSession(agentId)
})
