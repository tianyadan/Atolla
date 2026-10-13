import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { AgentDetailPage } from './pages/AgentDetail'
import { AgentsPage } from './pages/Agents'
import { ChatHistoryPage } from './pages/ChatHistory'
import { InstancesPage } from './pages/Instances'
import { LoginPage } from './pages/Login'

/** App routes for mobile read-only relay UI */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/instances/:instanceId/agents" element={<AgentsPage />} />
          <Route
            path="/instances/:instanceId/agents/:agentId"
            element={<AgentDetailPage />}
          />
          <Route
            path="/instances/:instanceId/agents/:agentId/chat"
            element={<ChatHistoryPage />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/instances" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
