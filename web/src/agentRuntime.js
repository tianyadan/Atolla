/** 创建一轮新的运行明细。所有时间统一使用毫秒，便于实时刷新与结束后复用。 */
export function beginAgentRuntime(now = Date.now()) {
  return {
    startedAt: now,
    endedAt: 0,
    status: 'running',
    modelRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tools: [],
    llmInvocations: [],
  }
}

function closeRunningTool(runtime, now) {
  const tools = [...(runtime.tools || [])]
  const index = tools.findLastIndex((tool) => tool.status === 'running')
  if (index < 0) return tools
  const tool = tools[index]
  tools[index] = {
    ...tool,
    status: 'completed',
    durationMs: Math.max(1, now - tool.startedAt),
  }
  return tools
}

/** 记录工具开始；下一个工具开始时自动收口上一个工具的耗时。 */
export function recordRuntimeTool(runtime, event, now = Date.now()) {
  if (!runtime?.startedAt) return runtime
  const name = String(event?.tool || event?.tool_name || '').trim()
  if (!name) return runtime
  // agent/codex 仅代表引擎心跳，不是实际工具调用。
  const heartbeat = new Set(['agent', 'codex', 'cursor', 'claude'])
  if (event?.type === 'activity' && heartbeat.has(name.toLowerCase())) return runtime
  const summary = String(event?.summary || '').trim()
  const current = (runtime.tools || []).findLast((tool) => tool.status === 'running')
  const completed = event?.type === 'command' || event?.done === true || event?.status === 'completed'
  if (current && completed && current.name.toLowerCase() === name.toLowerCase()) {
    const tools = [...(runtime.tools || [])]
    const index = tools.findLastIndex((tool) => tool === current)
    tools[index] = {
      ...current,
      summary: summary || current.summary,
      status: 'completed',
      durationMs: Math.max(1, Number(event?.duration_ms) || now - current.startedAt),
    }
    return { ...runtime, tools }
  }
  // 同一活动可能由引擎重复上报，避免把一次调用拆成多行。
  if (current && current.name === name && current.summary === summary) return runtime
  const tools = closeRunningTool(runtime, now)
  tools.push({
    id: `${now}-${tools.length + 1}`,
    name,
    summary,
    startedAt: now,
    durationMs: completed ? Math.max(0, Number(event?.duration_ms) || 0) : 0,
    status: completed ? 'completed' : 'running',
  })
  return { ...runtime, tools }
}

/** 记录 CLI 可观测调用的开始/结束；明确区别于 CLI 内部真实 API 请求。 */
export function recordRuntimeLLMTrace(runtime, event, now = Date.now()) {
  if (!runtime?.startedAt) return runtime
  const type = String(event?.type || '')
  const traceKey = String(event?.trace_id || event?.trace_run_id || '').trim()
  if (!traceKey) return runtime
  const traces = [...(runtime.llmInvocations || [])]
  const index = traces.findIndex((item) => String(item.traceKey) === traceKey)
  if (type === 'llm_trace_start') {
    if (index >= 0) return runtime
    traces.push({
      traceKey,
      id: event?.trace_id || traceKey,
      stepNo: Number(event?.step_no) || traces.length + 1,
      agentId: Number(event?.agent_id) || 0,
      engine: String(event?.engine || ''),
      source: String(event?.source || 'Atolla Derived'),
      model: String(event?.model || '引擎未提供'),
      status: 'running',
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      contextWindow: 0,
      contextUsed: 0,
      inputContent: String(event?.input_content || ''),
      outputContent: '',
      availabilityNote: String(event?.availability_note || ''),
      startedAt: now,
    })
  } else if (type === 'llm_trace_end' && index >= 0) {
    traces[index] = {
      ...traces[index],
      status: event?.status === 'success' ? 'success' : 'failed',
      durationMs: Math.max(0, Number(event?.duration_ms) || now - traces[index].startedAt),
      outputContent: String(event?.output_content || ''),
      endedAt: now,
    }
  }
  return { ...runtime, modelRequests: traces.length, llmInvocations: traces }
}

function applyUsageToTrace(traces, event) {
  const traceKey = String(event?.trace_id || event?.trace_run_id || '').trim()
  let index = traceKey ? traces.findIndex((item) => String(item.traceKey) === traceKey) : -1
  if (index < 0) index = traces.findLastIndex((item) => item.status === 'running')
  if (index < 0) return traces
  const next = [...traces]
  next[index] = {
    ...next[index],
    inputTokens: Number(event?.input_tokens) || 0,
    outputTokens: Number(event?.output_tokens) || 0,
    cacheTokens: (Number(event?.cache_read_tokens) || 0) + (Number(event?.cache_write_tokens) || 0),
    contextWindow: Number(event?.window_tokens) || 0,
    contextUsed: Number(event?.used_tokens) || 0,
  }
  return next
}

/** 累计引擎提供的回合级 Usage；不把 Usage 事件次数包装成真实模型请求次数。 */
export function recordRuntimeUsage(runtime, event) {
  if (!runtime?.startedAt) return runtime
  const input = Number(event?.input_tokens) || 0
  const output = Number(event?.output_tokens) || 0
  const cache = (Number(event?.cache_read_tokens) || 0) + (Number(event?.cache_write_tokens) || 0)
  const turn = Number(event?.turn_tokens) || input + output + cache
  const traces = applyUsageToTrace(runtime.llmInvocations || [], event)
  return {
    ...runtime,
    modelRequests: traces.length || runtime.modelRequests,
    inputTokens: runtime.inputTokens + input,
    outputTokens: runtime.outputTokens + output,
    totalTokens: runtime.totalTokens + turn,
    llmInvocations: traces,
  }
}

/** 结束本轮运行，同时收口仍在执行的工具。 */
export function finishAgentRuntime(runtime, status = 'completed', now = Date.now()) {
  if (!runtime?.startedAt || runtime.endedAt) return runtime
  return {
    ...runtime,
    endedAt: now,
    status,
    tools: closeRunningTool(runtime, now),
  }
}

/** 给展示层生成实时快照，不修改原始会话状态。 */
export function agentRuntimeSnapshot(runtime, now = Date.now()) {
  if (!runtime?.startedAt) return null
  const end = runtime.endedAt || now
  const durationMs = Math.max(0, end - runtime.startedAt)
  const tools = (runtime.tools || []).map((tool) => ({
    ...tool,
    durationMs: tool.status === 'running'
      ? Math.max(1, now - tool.startedAt)
      : tool.durationMs,
  }))
  return {
    ...runtime,
    durationMs,
    tools,
    generationSpeed: durationMs > 0
      ? runtime.outputTokens / (durationMs / 1000)
      : 0,
  }
}

function timeMs(value) {
  if (!value) return 0
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

/** 刷新后前端内存已清空时，依据服务端数字员工状态恢复本轮运行明细入口。 */
export function runtimeFromActiveAgent(agent, now = Date.now()) {
  const activeStatuses = new Set(['running', 'busy', 'waiting', 'compressing', '插话中'])
  if (!activeStatuses.has(String(agent?.status || ''))) return null
  const startedAt = timeMs(agent?.run_started_at) || timeMs(now)
  if (!startedAt) return null
  return beginAgentRuntime(startedAt)
}

/** 把服务端审计记录还原为前端运行快照，供刷新后展示最近一次任务。 */
export function runtimeFromAudit(item) {
  if (!item?.id || !item?.started_at) return null
  const startedAt = timeMs(item.started_at)
  if (!startedAt) return null
  const processing = item.status === 'processing'
  const finishedAt = timeMs(item.finished_at)
  const endedAt = processing ? 0 : (finishedAt || startedAt + Math.max(0, Number(item.duration_ms) || 0))
  const rawTools = Array.isArray(item.tools) ? item.tools : []
  const tools = rawTools.map((tool, index) => ({
    id: `audit-${tool.id || index}`,
    name: tool.tool_name || 'Tool',
    summary: tool.summary || '',
    startedAt: timeMs(tool.created_at) || startedAt,
    durationMs: Math.max(0, Number(tool.duration_ms) || 0),
    status: processing && index === rawTools.length - 1 ? 'running' : 'completed',
  }))
  const llmInvocations = (Array.isArray(item.llm_invocations) ? item.llm_invocations : []).map((trace, index) => ({
    traceKey: String(trace.id || `audit-${index}`),
    id: trace.id || `audit-${index}`,
    stepNo: Number(trace.step_no) || index + 1,
    agentId: Number(trace.agent_id) || 0,
    engine: trace.engine || '',
    source: trace.source || 'Atolla Derived',
    model: trace.model || '引擎未提供',
    status: trace.status || 'failed',
    durationMs: Math.max(0, Number(trace.duration_ms) || 0),
    inputTokens: Number(trace.input_tokens) || 0,
    outputTokens: Number(trace.output_tokens) || 0,
    cacheTokens: Number(trace.cache_tokens) || 0,
    contextWindow: Number(trace.context_window) || 0,
    contextUsed: Number(trace.context_used) || 0,
    inputContent: trace.input_content || '',
    outputContent: trace.output_content || '',
    inputTruncated: !!trace.input_truncated,
    outputTruncated: !!trace.output_truncated,
    availabilityNote: trace.availability_note || '',
    startedAt: timeMs(trace.started_at) || startedAt,
    endedAt: timeMs(trace.finished_at),
  }))
  return {
    startedAt,
    endedAt,
    status: processing ? 'running' : item.status,
    modelRequests: llmInvocations.length,
    inputTokens: Number(item.input_tokens) || 0,
    outputTokens: Number(item.output_tokens) || 0,
    totalTokens: Number(item.total_tokens) || 0,
    tools,
    llmInvocations,
  }
}

/** 实时会话和后端审计同时存在时，始终选择开始时间更新的一轮。 */
export function pickLatestRuntime(liveRuntime, persistedRuntime) {
  if (!liveRuntime) return persistedRuntime || null
  if (!persistedRuntime) return liveRuntime
  return Number(liveRuntime.startedAt) >= Number(persistedRuntime.startedAt)
    ? liveRuntime
    : persistedRuntime
}

/** 本地 SSE 正在运行时必须优先实时轨迹，禁止被稍晚创建的数据库快照覆盖。 */
export function selectRuntimeDetail(liveRuntime, persistedRuntime, localStreamActive = false) {
  if (localStreamActive && liveRuntime) return liveRuntime
  return pickLatestRuntime(liveRuntime, persistedRuntime)
}
