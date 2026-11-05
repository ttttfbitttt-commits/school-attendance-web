import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PlatformPortal, PlatformSchoolDeletionConfirmation } from './PlatformDashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/supervisor/delete-confirm'
      ? <PlatformSchoolDeletionConfirmation />
      : window.location.pathname === '/supervisor'
        ? <PlatformPortal />
        : <App />}
  </StrictMode>,
)
