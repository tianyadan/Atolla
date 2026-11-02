import { useState } from 'react'
import { agentRuntimeSnapshot } from './agentRuntime.js'

function fmtDuration(ms) {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`
  const min = Math.floor(value / 60_000)
  const sec = Math.floor((value % 60_000) / 1000)
  return `${min}m ${sec}s`
}

function fmtTokens(value) {
  const n = Number(value) || 0
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`
}

function prettyTraceContent(value) {
  const text = String(value || '').trim()
  if (!text) return '引擎未提供'
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function copyTraceContent(value) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  void navigator.clipboard.writeText(String(value || ''))
}

function RuntimeMetric({ icon, label, value, hint = '' }) {
  return (
    <div className="ma-runtime-metric">
      <span className="ma-runtime-metric-icon" aria-hidden="true">{icon}</span>
      <span className="ma-runtime-metric-copy">
        <small>{label}</small>
        <strong>{value}</strong>
        {hint ? <em>{hint}</em> : null}
      </span>
    </div>
  )
}

/** 输入框上方的单轮 Agent 运行明细；数据来自当前页面已接收的 SSE 事件。 */
export default function AgentRuntimeDetail({
  open,
  runtime,
  agent,
  context,
  parallelCount = 0,
  onClose,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [detailTab, setDetailTab] = useState('tools')
  const [selectedTraceKey, setSelectedTraceKey] = useState('')
  const snapshot = agentRuntimeSnapshot(runtime)
  const tools = snapshot?.tools || []
  const traces = snapshot?.llmInvocations || []
  const selectedTrace = traces.find((trace) => String(trace.traceKey) === selectedTraceKey) || traces.at(-1) || null
  const maxToolMs = Math.max(1, ...tools.map((tool) => tool.durationMs || 0))
  const contextUsed = Number(context?.used) || 0
  const contextWindow = Number(context?.window) || 0
  const contextPct = contextWindow > 0 ? Math.min(100, Math.round((contextUsed / contextWindow) * 100)) : 0
  const visibleTools = tools.slice(-8)

  if (!open) return null

  return (
    <section className={`ma-runtime-sheet${collapsed ? ' is-collapsed' : ''}`} aria-label="Agent 运行明细">
      <header className="ma-runtime-head">
        <div className="ma-runtime-title">
          <span className="ma-runtime-wave" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <div>
            <strong>Agent 运行明细</strong>
            <p>本轮请求、工具调用、性能与上下文信息</p>
          </div>
          <span className={`ma-runtime-state st-${snapshot?.status || 'empty'}`}>
            {snapshot?.status === 'running' ? '运行中' : snapshot ? '已结束' : '等待任务'}
          </span>
        </div>
        <div className="ma-runtime-head-actions">
          <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? '展开运行明细' : '收起运行明细'}>
            {collapsed ? '⌃' : '−'}
          </button>
          <button type="button" onClick={onClose} aria-label="关闭运行明细">×</button>
        </div>
      </header>

      {!collapsed ? (
        snapshot ? (
          <div className="ma-runtime-content">
            <div className="ma-runtime-metrics">
              <RuntimeMetric icon="◷" label="请求总耗时" value={fmtDuration(snapshot.durationMs)} />
              <RuntimeMetric icon="◇" label="模型调用轨迹" value={`${snapshot.modelRequests} 次`} hint="CLI 可观测边界" />
              <RuntimeMetric icon="⌘" label="工具调用次数" value={`${tools.length} 次`} />
              <RuntimeMetric icon="◎" label="Token 消耗" value={fmtTokens(snapshot.totalTokens)} />
              <RuntimeMetric icon="ϟ" label="生成速度" value={snapshot.outputTokens > 0 ? `${snapshot.generationSpeed.toFixed(1)} tokens/s` : '计算中'} />
              <RuntimeMetric icon="⑂" label="并行执行" value={parallelCount > 0 ? `${parallelCount} 路` : '未启用'} />
            </div>

            <div className="ma-runtime-tabs" role="tablist" aria-label="运行明细类型">
              <button type="button" role="tab" aria-selected={detailTab === 'tools'} className={detailTab === 'tools' ? 'is-active' : ''} onClick={() => setDetailTab('tools')}>
                工具调用 <span>{tools.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={detailTab === 'llm'} className={detailTab === 'llm' ? 'is-active' : ''} onClick={() => setDetailTab('llm')}>
                模型调用 <span>{traces.length}</span>
              </button>
            </div>

            {detailTab === 'tools' ? <div className="ma-runtime-grid">
              <section className="ma-runtime-block ma-runtime-tools">
                <h4>工具执行明细</h4>
                {visibleTools.length ? (
                  <div className="ma-runtime-tool-scroll">
                    <div className="ma-runtime-tool-table" role="table" aria-label="工具执行明细">
                      <div className="ma-runtime-tool-row is-head" role="row">
                        <span>工具名称</span><span>调用内容</span><span>状态</span><span>耗时</span><span>时间线</span>
                      </div>
                      {visibleTools.map((tool) => (
                        <div className="ma-runtime-tool-row" role="row" key={tool.id} title={tool.summary || tool.name}>
                          <code>{tool.name}</code>
                          <span className="ma-runtime-tool-summary" title={tool.summary || ''}>{tool.summary || '—'}</span>
                          <span className={`ma-runtime-tool-status st-${tool.status}`}><i />{tool.status === 'running' ? '运行中' : '已完成'}</span>
                          <span className="ma-runtime-num">{fmtDuration(tool.durationMs)}</span>
                          <span className="ma-runtime-tool-track"><i style={{ width: `${Math.max(8, (tool.durationMs / maxToolMs) * 100)}%` }} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <p className="ma-runtime-empty">当前任务尚未调用工具</p>}
              </section>

              <aside className="ma-runtime-side">
                <section className="ma-runtime-block">
                  <h4>上下文信息</h4>
                  <dl className="ma-runtime-context">
                    <div><dt>引擎</dt><dd>{agent?.engine || '—'}</dd></div>
                    <div><dt>工作区</dt><dd title={agent?.workspace_path || ''}>{agent?.workspace_path || '未绑定'}</dd></div>
                    <div><dt>来源</dt><dd>{context?.source || (context?.estimated ? '估算' : '实时')}</dd></div>
                    <div><dt>上下文</dt><dd>{contextWindow > 0 ? `${fmtTokens(contextUsed)} / ${fmtTokens(contextWindow)} (${contextPct}%)` : '等待探测'}</dd></div>
                  </dl>
                  {contextWindow > 0 ? <div className="ma-runtime-context-bar"><i style={{ width: `${contextPct}%` }} /></div> : null}
                </section>
                <section className="ma-runtime-block ma-runtime-parallel">
                  <h4>并行执行</h4>
                  <p>{parallelCount > 0 ? `当前包含 ${parallelCount} 路数字员工委托` : '当前任务为串行执行'}</p>
                </section>
              </aside>
            </div> : (
              <div className="ma-runtime-trace-layout">
                <section className="ma-runtime-trace-list" aria-label="模型调用列表">
                  {traces.length ? traces.map((trace, index) => (
                    <button
                      type="button"
                      key={trace.traceKey || trace.id || index}
                      className={selectedTrace === trace ? 'is-active' : ''}
                      onClick={() => setSelectedTraceKey(String(trace.traceKey))}
                    >
                      <span className="ma-runtime-trace-step">Step {String(trace.stepNo || index + 1).padStart(2, '0')}</span>
                      <strong>{trace.model || '引擎未提供'}</strong>
                      <small>{trace.source || 'Atolla Derived'} · {fmtDuration(trace.durationMs)}</small>
                      <i className={`st-${trace.status || 'failed'}`}>{trace.status === 'running' ? '进行中' : trace.status === 'success' ? '成功' : '失败'}</i>
                    </button>
                  )) : <p className="ma-runtime-empty">本轮没有可回溯的模型调用轨迹</p>}
                </section>

                <section className="ma-runtime-trace-detail">
                  {selectedTrace ? (
                    <>
                      <div className="ma-runtime-trace-summary">
                        <span><small>Input</small><strong>{fmtTokens(selectedTrace.inputTokens)}</strong></span>
                        <span><small>Output</small><strong>{fmtTokens(selectedTrace.outputTokens)}</strong></span>
                        <span><small>Cache</small><strong>{fmtTokens(selectedTrace.cacheTokens)}</strong></span>
                        <span><small>上下文</small><strong>{selectedTrace.contextWindow > 0 ? `${fmtTokens(selectedTrace.contextUsed)} / ${fmtTokens(selectedTrace.contextWindow)}` : '不可获取'}</strong></span>
                      </div>
                      {selectedTrace.availabilityNote ? <p className="ma-runtime-trace-note">{selectedTrace.availabilityNote}</p> : null}
                      <details open className="ma-runtime-trace-content">
                        <summary>输入内容 <em>平台可见输入{selectedTrace.inputTruncated ? ' · 已截断' : ''}</em></summary>
                        <button type="button" onClick={() => copyTraceContent(selectedTrace.inputContent)}>复制</button>
                        <pre>{prettyTraceContent(selectedTrace.inputContent)}</pre>
                      </details>
                      <details className="ma-runtime-trace-content">
                        <summary>输出内容 <em>{selectedTrace.outputTruncated ? '已截断' : 'CLI 返回'}</em></summary>
                        <button type="button" onClick={() => copyTraceContent(selectedTrace.outputContent)}>复制</button>
                        <pre>{prettyTraceContent(selectedTrace.outputContent)}</pre>
                      </details>
                    </>
                  ) : <p className="ma-runtime-empty">选择一条模型调用查看明细</p>}
                </section>
              </div>
            )}
          </div>
        ) : (
          <div className="ma-runtime-empty-state">
            <span aria-hidden="true">⌁</span>
            <strong>暂无本轮运行数据</strong>
            <p>发送任务后，这里会实时展示模型、工具、Token 与上下文明细。</p>
          </div>
        )
      ) : null}
    </section>
  )
}
