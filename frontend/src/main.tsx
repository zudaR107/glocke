import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { applyTheme, getStoredTheme } from '@zudar107/schloss-ui'
import { queryClient } from './lib/queryClient'
import { App } from './App'
import './index.css'

applyTheme(getStoredTheme())

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(<StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>)
