import { useMemo, useState } from 'react'
import JellyCanvas from './JellyCanvas.jsx'
import JellyDrawer from './JellyDrawer.jsx'
import JellyApprovalCards from './JellyApprovalCards.jsx'
import JellyRail from './JellyRail.jsx'
import JellyTopBar from './JellyTopBar.jsx'
import { UI_MODE_JELLY, UI_MODE_CLASSIC } from './uiMode.js'
import './jelly.css'

const DEMO_AGENTS = [
  { id: 'pm', n: '产品经理', t: '整理需求清单', s: 'idle', u: 0.10, len: 0.42 },
  { id: 'ui', n: 'UI 设计师', t: '画环礁视图', s: 'working', u: 0.27, len: 0.55 },
  { id: 'be', n: '后端', t: '重构任务清理 · 5/8', s: 'working', u: 0.42, len: 0.6, lead: true },
  { id: 'fe', n: '前端', t: '水母动效', s: 'working', u: 0.58, len: 0.58 },
  { id: 'qa', n: '测试', t: '用例超时，等你看看', s: 'wait', u: 0.74, len: 0.5 },
  { id: 'doc', n: '文档', t: '休息中', s: 'idle', u: 0.90, len: 0.38 },
]

const DEMO_APPROVALS = [
  {
    id: 'ap1',
    agentId: 'qa',
    title: '导出任务的集成用例超时 3 次，要重跑还是先跳过？',
    actions: [
      { k: 'rerun', l: '重跑', pri: 1 },
      { k: 'skip', l: '先跳过' },
    ],
  },
]

/**
 * 无后端预览水母界面（#jelly-demo），方便视觉验收与截图。
 */
export default function JellyDemoPage({ onExit }) {
  const [agents, setAgents] = useState(DEMO_AGENTS)
  const [approvals, setApprovals] = useState(DEMO_APPROVALS)
  const [drawerAgent, setDrawerAgent] = useState(
    () => (typeof location !== 'undefined' && location.hash.includes('drawer') ? DEMO_AGENTS.find((a) => a.id === 'qa') : null),
  )
  const [ask, setAsk] = useState('')
  const [uiMode, setUiMode] = useState(UI_MODE_JELLY)
  const teams = useMemo(() => [{ id: '1', name: 'sales-analytics 开发团队' }], [])
  const agentsById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])

  function resolveApproval(ap, action) {
    setApprovals((prev) => prev.filter((x) => x.id !== ap.id))
    setAgents((prev) => prev.map((a) => (
      a.id === ap.agentId
        ? { ...a, s: action === 'skip' ? 'idle' : 'working', t: action === 'skip' ? '已跳过，休息中' : '重跑集成用例' }
        : a
    )))
  }

  if (uiMode === UI_MODE_CLASSIC) {
    return (
      <div className="app app-admin" style={{ minHeight: '100vh', background: '#0b1220', color: '#e2e8f0' }}>
        <header className="topbar admin-topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #1e293b' }}>
          <h1 style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 18, margin: 0 }}>
            <img className="brand-logo" src="/brand-jellyfish-white.png" alt="" width="28" height="28" />
            <span className="brand-name">Atolla</span>
            <span className="admin-ver" style={{ opacity: 0.6, fontSize: 12 }}>经典界面</span>
          </h1>
          <div className="topbar-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="ui-mode-toggle" role="group" aria-label="界面切换">
              <button type="button" className="on" onClick={() => setUiMode(UI_MODE_CLASSIC)}>经典界面</button>
              <button type="button" onClick={() => setUiMode(UI_MODE_JELLY)}>水母界面</button>
            </div>
          </div>
        </header>
        <div className="admin-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>
          <aside className="admin-side" style={{ width: 200, borderRight: '1px solid #1e293b', padding: 12 }}>
            <div style={{ opacity: 0.7, fontSize: 13, marginBottom: 8 }}>数字人</div>
            <div style={{ padding: '8px 10px', background: 'rgba(56,189,248,.15)', borderRadius: 8 }}>对话</div>
            <div style={{ padding: '8px 10px', opacity: 0.55 }}>数字人管理</div>
            <div style={{ padding: '8px 10px', opacity: 0.55, marginTop: 12 }}>审计</div>
            <div style={{ padding: '8px 10px', opacity: 0.55 }}>网络白名单</div>
            <div style={{ padding: '8px 10px', opacity: 0.55 }}>设置</div>
          </aside>
          <main className="admin-main" style={{ flex: 1, padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>工作组 · 经典列表</h2>
            <p style={{ color: '#94a3b8' }}>现有数字人对话 / 工作组列表保持原样，未改动。通过右上角切换到水母界面。</p>
            <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
              {agents.map((a) => (
                <div key={a.id} style={{ padding: '12px 14px', background: '#111827', borderRadius: 10, border: '1px solid #1f2937' }}>
                  <strong>{a.n}</strong>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{a.t}</div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="jelly-app">
      <JellyRail activeId="agents" onNavigate={() => {}} />
      <JellyTopBar
        teams={teams}
        teamId="1"
        uiMode={uiMode}
        onUiModeChange={setUiMode}
        onHire={() => {}}
        onMenu={() => {}}
      />
      <div className="jelly-main is-jelly">
        <div className={`jelly-workspace ${drawerAgent ? 'drawer-open' : ''}`}>
          <JellyCanvas
            agents={agents}
            hasAlarm={approvals.length > 0}
            drawerOpen={!!drawerAgent}
            askValue={ask}
            onAskChange={setAsk}
            onAskSubmit={() => {
              const text = ask.trim()
              if (!text) return
              setAsk('')
              setAgents((prev) => {
                const idle = prev.find((a) => a.s === 'idle') || prev[0]
                return prev.map((a) => (a.id === idle.id ? { ...a, s: 'working', t: text } : a))
              })
            }}
            onSelectAgent={(a) => setDrawerAgent(a)}
            onEmptyClick={() => setDrawerAgent(null)}
          />
          <JellyApprovalCards
            approvals={approvals}
            agentsById={agentsById}
            drawerAgentId={drawerAgent?.id}
            drawerOpen={!!drawerAgent}
            onAction={resolveApproval}
            onOpenAgent={(id) => setDrawerAgent(agents.find((a) => a.id === id) || null)}
          />
          <JellyDrawer
            open={!!drawerAgent}
            agent={drawerAgent}
            approvals={approvals}
            authHeaders={() => ({})}
            onClose={() => setDrawerAgent(null)}
            onExpand={() => {}}
            onApprovalAction={resolveApproval}
            seedMessages={drawerAgent?.id === 'qa' ? [
              { role: 'assistant', content: '导出任务的集成用例 `SalesBudgetExportIT` 连续超时 3 次，看起来是 MinIO 上传在测试环境里很慢。' },
              { role: 'assistant', content: '我可以把超时从 30 秒放宽到 90 秒后重跑，或者先跳过这个用例，其余 29 个都通过了。' },
            ] : null}
          />
          <div className={`jelly-hint ${drawerAgent ? 'hide' : ''}`}>
            点一根触手，和那位员工说话 · 示例数据
          </div>
        </div>
      </div>
    </div>
  )
}
