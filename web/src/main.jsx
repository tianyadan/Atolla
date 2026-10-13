import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './scrollbars.css'
import { installAutoHideScrollbars } from './scrollbars.js'
import App from './App.jsx'

installAutoHideScrollbars()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
