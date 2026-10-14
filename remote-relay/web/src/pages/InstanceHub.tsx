import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgentsHubIcon, GroupChatHubIcon } from '../components/HubIcons'
import { PageShell } from '../components/PageShell'

/** 4-grid feature menu after instance unlock */
export function InstanceHubPage() {
  const { instanceId = '' } = useParams()
  const navigate = useNavigate()
  const [toast, setToast] = useState<string | null>(null)
  const base = `/instances/${encodeURIComponent(instanceId)}`

  /** Show under-development notice */
  function onGroupChat() {
    setToast('群聊功能正在开发')
    window.setTimeout(() => setToast(null), 2200)
  }

  return (
    <PageShell title="功能" backTo="/instances">
      {toast ? <p className="toast-banner">{toast}</p> : null}
      <div className="hub-grid">
        <button
          type="button"
          className="hub-cell"
          onClick={() => navigate(`${base}/agents`)}
        >
          <span className="hub-icon">
            <AgentsHubIcon />
          </span>
          <span className="hub-label">数字员工</span>
        </button>
        <button type="button" className="hub-cell" onClick={onGroupChat}>
          <span className="hub-icon">
            <GroupChatHubIcon />
          </span>
          <span className="hub-label">群聊</span>
        </button>
        <div className="hub-cell hub-cell-empty" aria-hidden>
          <span className="hub-icon muted">+</span>
          <span className="hub-label muted">敬请期待</span>
        </div>
        <div className="hub-cell hub-cell-empty" aria-hidden>
          <span className="hub-icon muted">+</span>
          <span className="hub-label muted">敬请期待</span>
        </div>
      </div>
    </PageShell>
  )
}
