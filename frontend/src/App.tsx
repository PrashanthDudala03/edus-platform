import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/auth'
import { Shell } from './components/Shell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SuiteRouter, { SchoolModules } from './pages/suite/SuitePage'
import DirectoryPage from './pages/DirectoryPage'
import { AttendancePage, AnnouncementsPage, AuditPage, SettingsPage } from './pages/OperationsPages'
const queryClient = new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15000,refetchOnWindowFocus:false}}})
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.user?.schoolId !== previous.user?.schoolId) queryClient.clear()
})
function Protected() {
  const {isAuthenticated,user}=useAuthStore()
  const location=useLocation()
  if(isAuthenticated&&user&&!user.roles.some(r=>["SuperAdmin","Principal"].includes(r))&&!location.pathname.startsWith("/suite"))return <Navigate to="/suite" replace/>
  return isAuthenticated && user ? <Shell><Outlet /></Shell> : <Navigate to="/login" replace />
}
export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<Protected />}>
      <Route index element={<DashboardPage />} />
      <Route path="suite" element={<SchoolModules />} />
      <Route path="suite/:kind" element={<SuiteRouter />} />
      <Route path="students" element={<DirectoryPage key="students" kind="students" />} />
      <Route path="teachers" element={<DirectoryPage key="teachers" kind="teachers" />} />
      <Route path="parents" element={<DirectoryPage key="parents" kind="parents" />} />
      <Route path="attendance" element={<AttendancePage />} />
      <Route path="announcements" element={<AnnouncementsPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route><Route path="*" element={<Navigate to="/" replace />} />
  </Routes></BrowserRouter></QueryClientProvider>
}
