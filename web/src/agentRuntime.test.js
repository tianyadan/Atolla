import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentRuntimeSnapshot,
  beginAgentRuntime,
  finishAgentRuntime,
  pickLatestRuntime,
  recordRuntimeLLMTrace,
  recordRuntimeTool,
  recordRuntimeUsage,
  runtimeFromActiveAgent,
  runtimeFromAudit,
  selectRuntimeDetail,
} from './agentRuntime.js'

test('runtime detail records tool duration and usage metrics', () => {
  let runtime = beginAgentRuntime(1_000)
  runtime = recordRuntimeTool(runtime, { tool: 'bash', summary: '执行测试' }, 2_000)
  runtime = recordRuntimeTool(runtime, { tool: 'read_file', summary: '读取文件' }, 5_000)
  runtime = recordRuntimeLLMTrace(runtime, {
    type: 'llm_trace_start', trace_id: 1, source: 'Claude Stream', model: '引擎未提供',
  }, 5_100)
  runtime = recordRuntimeUsage(runtime, {
    trace_id: 1,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 20,
  })
  runtime = finishAgentRuntime(runtime, 'completed', 7_000)

  const snapshot = agentRuntimeSnapshot(runtime, 9_000)
  assert.equal(snapshot.durationMs, 6_000)
  assert.equal(snapshot.modelRequests, 1)
  assert.equal(snapshot.totalTokens, 170)
  assert.equal(snapshot.tools.length, 2)
  assert.equal(snapshot.tools[0].durationMs, 3_000)
  assert.equal(snapshot.tools[1].durationMs, 2_000)
  assert.equal(snapshot.generationSpeed, 50 / 6)
})

test('runtime detail records observable LLM traces without counting usage events as requests', () => {
  let runtime = beginAgentRuntime(1_000)
  runtime = recordRuntimeLLMTrace(runtime, {
    type: 'llm_trace_start', trace_id: 7, step_no: 1,
    source: 'Codex JSONL', model: '引擎未提供', input_content: '{"messages":[]}',
  }, 1_100)
  runtime = recordRuntimeUsage(runtime, {
    trace_id: 7, input_tokens: 100, output_tokens: 20, cache_read_tokens: 10,
    used_tokens: 110, window_tokens: 200_000,
  })
  runtime = recordRuntimeUsage(runtime, {
    trace_id: 7, input_tokens: 100, output_tokens: 20, cache_read_tokens: 10,
  })
  runtime = recordRuntimeLLMTrace(runtime, {
    type: 'llm_trace_end', trace_id: 7, status: 'success', duration_ms: 900,
    output_content: '{"text":"done"}',
  }, 2_000)

  assert.equal(runtime.modelRequests, 1)
  assert.equal(runtime.llmInvocations.length, 1)
  assert.equal(runtime.llmInvocations[0].source, 'Codex JSONL')
  assert.equal(runtime.llmInvocations[0].cacheTokens, 10)
  assert.equal(runtime.llmInvocations[0].status, 'success')
})

test('runtime detail restores the latest completed audit record', () => {
  const persisted = runtimeFromAudit({
    id: 9,
    status: 'completed',
    started_at: '2026-10-30T10:00:00Z',
    finished_at: '2026-10-30T10:00:03Z',
    duration_ms: 3000,
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    tools: [{ id: 1, tool_name: 'bash', duration_ms: 450, created_at: '2026-10-30T10:00:01Z' }],
    llm_invocations: [{
      id: 3, step_no: 1, source: 'Claude Stream', model: '引擎未提供', status: 'success',
      duration_ms: 2500, input_tokens: 100, output_tokens: 20, cache_tokens: 5,
      input_content: '{"visibility":"平台可见输入"}', output_content: '{"text":"ok"}',
      created_at: '2026-10-30T10:00:00Z',
    }],
  })
  assert.equal(persisted.status, 'completed')
  assert.equal(persisted.totalTokens, 120)
  assert.equal(persisted.tools[0].name, 'bash')
  assert.equal(persisted.tools[0].durationMs, 450)
  assert.equal(persisted.modelRequests, 1)
  assert.equal(persisted.llmInvocations[0].source, 'Claude Stream')

  const live = beginAgentRuntime(Date.parse('2026-10-30T10:01:00Z'))
  assert.equal(pickLatestRuntime(live, persisted), live)
  assert.equal(pickLatestRuntime(null, persisted), persisted)
})

test('runtime detail de-duplicates repeated activity events and keeps live duration', () => {
  let runtime = beginAgentRuntime(1_000)
  runtime = recordRuntimeTool(runtime, { tool: 'grep', summary: '搜索' }, 2_000)
  runtime = recordRuntimeTool(runtime, { tool: 'grep', summary: '搜索' }, 2_500)

  const snapshot = agentRuntimeSnapshot(runtime, 4_000)
  assert.equal(snapshot.tools.length, 1)
  assert.equal(snapshot.tools[0].durationMs, 2_000)
  assert.equal(snapshot.status, 'running')
})

test('runtime detail restores an active run after the page refreshes', () => {
  const runtime = runtimeFromActiveAgent({
    status: 'running',
    run_started_at: '2026-10-30T10:00:00Z',
  }, Date.parse('2026-10-30T10:02:00Z'))

  assert.equal(runtime.status, 'running')
  assert.equal(runtime.startedAt, Date.parse('2026-10-30T10:00:00Z'))
  assert.equal(runtime.endedAt, 0)
  assert.equal(runtimeFromActiveAgent({ status: 'idle' }), null)
})

test('runtime detail keeps live SSE trace ahead of a newer but stale audit snapshot', () => {
  const live = { ...beginAgentRuntime(1_000), llmInvocations: [{ traceKey: 'live' }] }
  const staleAudit = { ...beginAgentRuntime(1_100), llmInvocations: [] }

  assert.equal(selectRuntimeDetail(live, staleAudit, true), live)
  assert.equal(selectRuntimeDetail(live, staleAudit, false), staleAudit)
})

test('runtime detail ignores engine heartbeat and records completed command content', () => {
  let runtime = beginAgentRuntime(1_000)
  runtime = recordRuntimeTool(runtime, {
    type: 'activity',
    tool: 'agent',
    summary: 'agent 执行中…',
  }, 2_000)
  runtime = recordRuntimeTool(runtime, {
    type: 'command',
    tool_name: 'Bash',
    summary: 'npm run build',
  }, 3_000)

  assert.equal(runtime.tools.length, 1)
  assert.equal(runtime.tools[0].name, 'Bash')
  assert.equal(runtime.tools[0].summary, 'npm run build')
  assert.equal(runtime.tools[0].status, 'completed')
})
