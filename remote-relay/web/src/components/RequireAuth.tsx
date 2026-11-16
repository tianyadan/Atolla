import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getToken } from '../api'
import { IslandBusySyncHost } from './IslandBusySyncHost'
import { hasAuthenticatedConnection } from '../utils/connectionSession'

/** Redirect to login when no JWT in storage；已登录时挂上岛同步 */
export function RequireAuth() {
  const location = useLocation()
  if (!hasAuthenticatedConnection(getToken())) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return (
    <>
      <IslandBusySyncHost />
      <Outlet />
    </>
  )
}
