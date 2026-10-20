import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
])

const API = '/api'

const STATUS_LABEL = {
  completed: '完成',
  failed: '失败',
  timeout: '超时',
  cancelled: '取消',
  interrupted: '中断',
}

function fmtTokens(n) {
  n = Number(n) || 0
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`
}

function fmtDuration(ms) {
  ms = Number(ms) || 0
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

function useChart(option) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  useEffect(() => {
    if (!ref.current) return undefined
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])
  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, true)
  }, [option])
  return ref
}

/**
 * 数字员工审计看板：执行次数 / Token / 工具 / 错误。
 */
export default function AgentAudit({ authHeaders, onUnauthorized, active }) {
  const [agents, setAgents] = useState([])
  const [agentId, setAgentId] = useState('')
  const [range, setRange] = useState('7d')
  const [overview, setOverview] = useState(null)
  const [daily, setDaily] = useState([])
  const [weekly, setWeekly] = useState([])
  const [tools, setTools] = useState([])
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [showMore, setShowMore] = useState(false)

  const query = useMemo(() => {
    const q = new URLSearchParams()
    if (agentId) q.set('agent_id', agentId)
    if (range === '30d') q.set('range', '30d')
    return q.toString()
  }, [agentId, range])

  const loadAgents = useCallback(async () => {
    const res = await fetch(`${API}/admin/agents`, { headers: authHeaders() })
    if (res.status === 401) {
      onUnauthorized?.()
      return
    }
    if (!res.ok) return
    const d = await res.json()
    setAgents(d.items || [])
  }, [authHeaders, onUnauthorized])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const headers = authHeaders()
      const paths = [
        `/admin/agent-audit/overview?${query}`,
        `/admin/agent-audit/tokens/daily?${query}`,
        `/admin/agent-audit/tokens/weekly?${query}`,
        `/admin/agent-audit/tools?${query}`,
        `/admin/agent-audit/errors?${query}&limit=20`,
      ]
      const responses = await Promise.all(paths.map((p) => fetch(`${API}${p}`, { headers })))
      if (responses.some((r) => r.status === 401)) {
        onUnauthorized?.()
        return
      }
      const bodies = await Promise.all(responses.map((r) => r.json()))
      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) throw new Error(bodies[i].error || '加载失败')
      }
      setOverview(bodies[0])
      setDaily(bodies[1].items || [])
      setWeekly(bodies[2].items || [])
      setTools(bodies[3].items || [])
      setErrors(bodies[4].items || [])
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onUnauthorized, query])

  useEffect(() => {
    if (!active) return
    void loadAgents()
    void load()
  }, [active, loadAgents, load])

  const dailyOpt = useMemo(() => ({
    color: ['#5b7c99', '#8fa8bc', '#c5d4e0'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['Input', 'Output', '合计'], bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 40, right: 16, top: 24, bottom: 36 },
    xAxis: { type: 'category', data: daily.map((d) => d.bucket), axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v) => fmtTokens(v) } },
    series: [
      { name: 'Input', type: 'line', smooth: true, data: daily.map((d) => d.input_tokens) },
      { name: 'Output', type: 'line', smooth: true, data: daily.map((d) => d.output_tokens) },
      { name: '合计', type: 'line', smooth: true, data: daily.map((d) => d.total_tokens) },
    ],
  }), [daily])

  const statusOpt = useMemo(() => {
    const counts = overview?.status_counts || []
    return {
      color: ['#4a7c59', '#c45c5c', '#c49a5c', '#8a8a8a', '#6b5b95'],
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        label: { formatter: '{b}\n{c}', fontSize: 11 },
        data: counts.map((s) => ({
          name: STATUS_LABEL[s.status] || s.status,
          value: s.count,
        })),
      }],
    }
  }, [overview])

  const topTools = overview?.top_tools || []
  const topOpt = useMemo(() => ({
    color: ['#5b7c99'],
    tooltip: { trigger: 'axis' },
    grid: { left: 80, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    yAxis: {
      type: 'category',
      data: [...topTools].reverse().map((t) => t.tool_name),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      type: 'bar',
      data: [...topTools].reverse().map((t) => t.call_count),
      barWidth: 14,
    }],
  }), [topTools])

  const dailyRef = useChart(dailyOpt)
  const statusRef = useChart(statusOpt)
  const topRef = useChart(topOpt)

  return (
    <section className="list agent-audit-panel">
      <div className="audit-toolbar">
        <h2>审计</h2>
        <p className="empty-hint">数字员工执行与 Token · 自落库起统计 · 不含项目协作</p>
      </div>

      <div className="audit-filters agent-audit-filters">
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">全部员工</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </select>
        <button type="button" className="new" disabled={loading} onClick={() => void load()}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {err ? <pre className="error">{err}</pre> : null}

      <div className="agent-audit-cards">
        <div className="agent-audit-card">
          <div className="agent-audit-card-label">总次数</div>
          <div className="agent-audit-card-value">{overview?.total_runs ?? '—'}</div>
        </div>
        <div className="agent-audit-card">
          <div className="agent-audit-card-label">正常完成</div>
          <div className="agent-audit-card-value">{overview?.completed_runs ?? '—'}</div>
        </div>
        <div className="agent-audit-card">
          <div className="agent-audit-card-label">失败</div>
          <div className="agent-audit-card-value">{overview?.failed_runs ?? '—'}</div>
          <div className="agent-audit-card-hint">含超时</div>
        </div>
        <div className="agent-audit-card">
          <div className="agent-audit-card-label">总 Token</div>
          <div className="agent-audit-card-value">{overview ? fmtTokens(overview.total_tokens) : '—'}</div>
          <div className="agent-audit-card-hint">
            平均耗时 {overview ? fmtDuration(overview.avg_duration_ms) : '—'}
          </div>
        </div>
      </div>

      <div className="agent-audit-grid">
        <div className="agent-audit-block">
          <h3>每日 Token</h3>
          {daily.length === 0 ? <p className="empty">暂无数据</p> : <div ref={dailyRef} className="agent-audit-chart" />}
        </div>
        <div className="agent-audit-block">
          <h3>执行状态</h3>
          {(overview?.status_counts || []).length === 0
            ? <p className="empty">暂无数据</p>
            : <div ref={statusRef} className="agent-audit-chart" />}
        </div>
        <div className="agent-audit-block">
          <h3>TOP 3 工具</h3>
          {topTools.length === 0 ? <p className="empty">暂无数据</p> : <div ref={topRef} className="agent-audit-chart" />}
        </div>
        <div className="agent-audit-block">
          <h3>最近错误</h3>
          {errors.length === 0 ? (
            <p className="empty">暂无错误</p>
          ) : (
            <ul className="agent-audit-errors">
              {errors.map((e) => (
                <li key={e.id}>
                  <div className="agent-audit-err-meta">
                    <span>{e.agent_name || `#${e.agent_id}`}</span>
                    <span>{STATUS_LABEL[e.status] || e.status}</span>
                    <span>{String(e.created_at).replace('T', ' ').slice(0, 19)}</span>
                  </div>
                  <div className="agent-audit-err-msg">{e.error_message || e.error_type || '—'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button type="button" className="ghost agent-audit-more-btn" onClick={() => setShowMore((v) => !v)}>
        {showMore ? '收起明细 ▴' : '每周 Token / 工具明细 ▾'}
      </button>

      {showMore && (
        <div className="agent-audit-more">
          <div className="agent-audit-block">
            <h3>每周 Token</h3>
            {weekly.length === 0 ? (
              <p className="empty">暂无数据</p>
            ) : (
              <table>
                <thead>
                  <tr><th>周起始（周一）</th><th>Input</th><th>Output</th><th>合计</th></tr>
                </thead>
                <tbody>
                  {weekly.map((w) => (
                    <tr key={w.bucket}>
                      <td>{w.bucket}</td>
                      <td>{fmtTokens(w.input_tokens)}</td>
                      <td>{fmtTokens(w.output_tokens)}</td>
                      <td>{fmtTokens(w.total_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="agent-audit-block">
            <h3>工具调用</h3>
            {tools.length === 0 ? (
              <p className="empty">暂无数据</p>
            ) : (
              <table>
                <thead>
                  <tr><th>工具</th><th>次数</th><th>成功</th><th>失败</th><th>拒绝</th><th>平均耗时</th></tr>
                </thead>
                <tbody>
                  {tools.map((t) => (
                    <tr key={t.tool_name}>
                      <td>{t.tool_name}</td>
                      <td>{t.call_count}</td>
                      <td>{t.ok_count}</td>
                      <td>{t.error_count}</td>
                      <td>{t.denied_count}</td>
                      <td>{fmtDuration(t.avg_duration_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
