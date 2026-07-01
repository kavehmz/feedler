import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Initialize theme before first paint (no flash): a stored choice wins;
// a missing OR corrupt value falls back to OS-then-light (settings_spec §6.1/§8).
const stored = localStorage.getItem('feedler.theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const validStored = stored === 'dark' || stored === 'light'
if (stored === 'dark' || (!validStored && prefersDark)) {
  document.documentElement.classList.add('dark')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
