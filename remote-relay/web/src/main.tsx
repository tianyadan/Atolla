import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initNativeShell } from './nativeShell'
import { initTheme } from './utils/theme'

// Apply persisted theme before first paint of React tree
initTheme()
void initNativeShell()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
