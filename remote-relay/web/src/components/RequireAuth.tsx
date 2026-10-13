import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getToken } from '../api'

/** Redirect to login when no JWT in storage */
export function RequireAuth() {
  const location = useLocation()
  if (!getToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
