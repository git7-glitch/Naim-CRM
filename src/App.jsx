import { useLayoutEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { isDemoMode, isMisconfiguredProduction } from './supabase/client'
import ConfigErrorScreen from './components/system/ConfigErrorScreen'
import DemoModeBanner from './components/system/DemoModeBanner'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CandidatesPage from './pages/CandidatesPage'
import JobsPage from './pages/JobsPage'
import AppointmentsPage from './pages/AppointmentsPage'
import TasksPage from './pages/TasksPage'
import DocumentsPage from './pages/DocumentsPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import AssociatesPage from './pages/AssociatesPage'
import CVBuilderPage from './pages/CVBuilderPage'
import JobGeneratorPage from './pages/JobGeneratorPage'
import ReceptionistViewPage from './pages/ReceptionistViewPage'
import WhatsAppPage from './pages/WhatsAppPage'
import RecycleBinPage from './pages/RecycleBinPage'
import { PageSpinner } from './components/ui/Spinner'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><PageSpinner /></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><PageSpinner /></div>
  if (user) return <Navigate to="/dashboard" replace />
  return children
}

function ScrollManager() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()

  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [navigationType, pathname])

  return null
}

function AppRoutes() {
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/candidates" element={<ProtectedRoute><CandidatesPage /></ProtectedRoute>} />
        <Route path="/jobs" element={<ProtectedRoute><JobsPage /></ProtectedRoute>} />
        <Route path="/appointments" element={<ProtectedRoute><AppointmentsPage /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/associates" element={<ProtectedRoute><AssociatesPage /></ProtectedRoute>} />
        <Route path="/cv-builder" element={<ProtectedRoute><CVBuilderPage /></ProtectedRoute>} />
        <Route path="/job-generator" element={<ProtectedRoute><JobGeneratorPage /></ProtectedRoute>} />
        <Route path="/receptionist-view" element={<ProtectedRoute><ReceptionistViewPage /></ProtectedRoute>} />
        <Route path="/whatsapp" element={<ProtectedRoute><WhatsAppPage /></ProtectedRoute>} />
        <Route path="/recycle-bin" element={<ProtectedRoute><RecycleBinPage /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  // CRM-10: never boot a production build without its database.
  if (isMisconfiguredProduction) return <ConfigErrorScreen />

  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
          {isDemoMode && <DemoModeBanner />}
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
