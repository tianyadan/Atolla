import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './scrollbars.css'
import { installAutoHideScrollbars } from './scrollbars.js'
import App from './App.jsx'
import JellyPreview from './JellyPreview.jsx'
import './App.css'

installAutoHideScrollbars()

const jellyPreview = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('jellyPreview')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {jellyPreview ? <JellyPreview /> : <App />}
  </StrictMode>,
)
