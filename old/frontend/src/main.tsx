import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Initialize theme from storage or system preference
const stored = localStorage.getItem('feedler.theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (stored === 'dark' || (!stored && prefersDark)) {
  document.documentElement.classList.add('dark')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
