import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/auth'
import { Shell } from './components/Shell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SuiteRouter, { SchoolModules } from './pages/suite/SuitePage'
import DirectoryPage from './pages/DirectoryPage'
import { AttendancePage, AnnouncementsPage, AuditPage, SettingsPage } from './pages/OperationsPages'
import { PlatformDashboard, SchoolsPage } from './pages/portals/PlatformPages'
import PrincipalDashboard from './pages/portals/PrincipalDashboard'
import TeacherDashboard from './pages/portals/TeacherDashboard'
import FamilyDashboard from './pages/portals/FamilyDashboard'
import { ForbiddenPage } from './pages/ForbiddenPage'
import { homeFor, roleOf, LEADERSHIP, SCHOOL_ROLES, type Role } from './roles'
const queryClient = new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15000,refetchOnWindowFocus:false}}})
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.user?.schoolId !== previous.user?.schoolId) queryClient.clear()
})
function Protected() {
  const {isAuthenticated,user}=useAuthStore()
  return isAuthenticated && user ? <Shell><Outlet /></Shell> : <Navigate to="/login" replace />
}
// Hides pages from roles that cannot use them. The API refuses those roles independently.
function RoleGate({allow}:{allow:Role[]}) {
  const role=roleOf(useAuthStore(s=>s.user))
  return allow.includes(role as Role) ? <Outlet /> : <ForbiddenPage />
}
function Home() { return <Navigate to={homeFor(roleOf(useAuthStore(s=>s.user)))} replace /> }
export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<Protected />}>
      <Route index element={<Home />} />
      <Route element={<RoleGate allow={['SuperAdmin']} />}>
        <Route path="super-admin" element={<PlatformDashboard />} />
        <Route path="super-admin/schools" element={<SchoolsPage />} />
      </Route>
      <Route element={<RoleGate allow={['Administrator']} />}>
        <Route path="admin" element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route element={<RoleGate allow={['Principal']} />}><Route path="principal" element={<PrincipalDashboard />} /></Route>
      <Route element={<RoleGate allow={['Teacher']} />}><Route path="teacher" element={<TeacherDashboard />} /></Route>
      <Route element={<RoleGate allow={['Parent']} />}><Route path="parent" element={<FamilyDashboard role="Parent" />} /></Route>
      <Route element={<RoleGate allow={['Student']} />}><Route path="student" element={<FamilyDashboard role="Student" />} /></Route>
      <Route element={<RoleGate allow={LEADERSHIP} />}>
        <Route path="students" element={<DirectoryPage key="students" kind="students" />} />
        <Route path="teachers" element={<DirectoryPage key="teachers" kind="teachers" />} />
        <Route path="parents" element={<DirectoryPage key="parents" kind="parents" />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route element={<RoleGate allow={SCHOOL_ROLES} />}>
        <Route path="suite" element={<SchoolModules />} />
        <Route path="suite/:kind" element={<SuiteRouter />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Route>
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes></BrowserRouter></QueryClientProvider>
}
