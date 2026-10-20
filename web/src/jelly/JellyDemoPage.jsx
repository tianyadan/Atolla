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
 * 无后端预览水母界面（开发/截图用，不挂进 App 主路径）。
 */
export default function JellyDemoPage({ onExit }) {
  const [agents, setAgents] = useState(DEMO_AGENTS)
  const [approvals, setApprovals] = useState(DEMO_APPROVALS)
  const [drawerAgent, setDrawerAgent] = useState(
    () => (typeof location !== 'undefined' && location.hash.includes('drawer') ? DEMO_AGENTS.find((a) => a.id === 'qa') : null),
  )
  const [ask, setAsk] = useState('')
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

  return (
    <div className="jelly-app">
      <JellyRail activeId="agents" onNavigate={() => {}} />
      <JellyTopBar
        teams={teams}
        teamId="1"
        uiMode={UI_MODE_JELLY}
        onUiModeChange={(mode) => {
          if (mode === UI_MODE_CLASSIC) onExit?.()
        }}
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
