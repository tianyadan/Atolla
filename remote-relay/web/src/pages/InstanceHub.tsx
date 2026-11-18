import { Navigate, useParams } from 'react-router-dom'

/**
 * Legacy「功能」hub removed — keep route for old bookmarks / deep links.
 * Redirect unlocked instance root → digital-agent management list.
 */
export function InstanceHubPage() {
  const { instanceId = '' } = useParams()
  if (!instanceId) return <Navigate to="/instances" replace />
  return (
    <Navigate
      to={`/instances/${encodeURIComponent(instanceId)}/agents`}
      replace
    />
  )
}
