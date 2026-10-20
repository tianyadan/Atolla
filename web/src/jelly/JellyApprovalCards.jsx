/**
 * 右上角审批浮卡：最多展示若干条，每条至多 2 个按钮。
 * drawer 打开且属于当前 agent 时由抽屉承接，此处隐藏。
 */
export default function JellyApprovalCards({
  approvals = [],
  agentsById = {},
  drawerAgentId = null,
  drawerOpen = false,
  onAction,
  onOpenAgent,
}) {
  const list = (approvals || []).filter((ap) => {
    if (!drawerOpen || !drawerAgentId) return true
    return String(ap.agentId) !== String(drawerAgentId)
  })
  if (!list.length) return null

  return (
    <div className={`jelly-appr ${drawerOpen ? 'shifted' : ''}`}>
      {list.slice(0, 4).map((ap) => {
        const agent = agentsById[String(ap.agentId)] || {}
        const name = agent.n || agent.name || '员工'
        return (
          <div key={ap.id} className="jelly-card">
            <div className="w">{name} 在等你拍板</div>
            <button
              type="button"
              className="q"
              onClick={() => onOpenAgent?.(ap.agentId)}
            >
              {ap.title}
            </button>
            <div className="row">
              {(ap.actions || []).slice(0, 2).map((x) => (
                <button
                  key={x.k}
                  type="button"
                  className={`jelly-btn ${x.pri ? 'pri' : ''}`}
                  onClick={() => onAction?.(ap, x.k)}
                >
                  {x.l}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
