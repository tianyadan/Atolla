import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { NativeDeepLinkHost } from './components/NativeDeepLinkHost'
import { NativeCredentialSyncHost } from './components/NativeCredentialSyncHost'
import { SplashOverlay } from './components/SplashOverlay'
import { AgentsPage } from './pages/Agents'
import { ChangelogPage } from './pages/Changelog'
import { ChatHistoryPage } from './pages/ChatHistory'
import { HomeRestorePage } from './pages/HomeRestore'
import { InstanceHubPage } from './pages/InstanceHub'
import { InstanceSettingsPage } from './pages/InstanceSettings'
import { InstancesPage } from './pages/Instances'
import { LoginPage } from './pages/Login'
import { SettingsPage } from './pages/Settings'
import { SettingsAboutPage } from './pages/settings/SettingsAboutPage'
import { SettingsLanguagePage } from './pages/settings/SettingsLanguagePage'
import { SettingsOtpPage } from './pages/settings/SettingsOtpPage'
import { SettingsPreferencesPage } from './pages/settings/SettingsPreferencesPage'
import { SettingsRelayPage } from './pages/settings/SettingsRelayPage'

/** App routes for mobile relay UI */
export default function App() {
  return (
    <BrowserRouter>
      <SplashOverlay />
      <NativeDeepLinkHost />
      <NativeCredentialSyncHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HomeRestorePage />} />
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/otp" element={<SettingsOtpPage />} />
          <Route path="/settings/relay" element={<SettingsRelayPage />} />
          <Route path="/settings/lan" element={<Navigate to="/settings/relay" replace />} />
          <Route path="/settings/language" element={<SettingsLanguagePage />} />
          <Route path="/settings/preferences" element={<SettingsPreferencesPage />} />
          <Route path="/settings/about" element={<SettingsAboutPage />} />
          <Route path="/settings/changelog" element={<ChangelogPage />} />
          <Route path="/instances/:instanceId" element={<InstanceHubPage />} />
          <Route path="/instances/:instanceId/start" element={<HomeRestorePage />} />
          <Route path="/instances/:instanceId/settings" element={<InstanceSettingsPage />} />
          <Route path="/instances/:instanceId/agents" element={<AgentsPage />} />
          <Route
            path="/instances/:instanceId/agents/:agentId"
            element={<Navigate to="chat" replace />}
          />
          <Route
            path="/instances/:instanceId/agents/:agentId/chat"
            element={<ChatHistoryPage />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
