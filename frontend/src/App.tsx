import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import client from './api/client'
import { canVisit } from './access'
import AccessControlPage from './pages/AccessControlPage'
import SignupPage from './pages/SignupPage'
import { useAuthStore } from './store/auth'
import { Shell } from './components/Shell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SuiteRouter, { SchoolModules } from './pages/suite/SuitePage'
import DirectoryPage from './pages/DirectoryPage'
import Student360Page from './pages/Student360Page'
import { AttendancePage, AnnouncementsPage, AuditPage, SettingsPage } from './pages/OperationsPages'
import { PlatformDashboard, SchoolsPage } from './pages/portals/PlatformPages'
import PrincipalDashboard from './pages/portals/PrincipalDashboard'
import TeacherDashboard from './pages/portals/TeacherDashboard'
import FamilyDashboard from './pages/portals/FamilyDashboard'
import { ForbiddenPage } from './pages/ForbiddenPage'
import BillingPage from './pages/billing/BillingPage'
import SubscriptionPage from './pages/billing/SubscriptionPage'
import SchoolHomePage, { SchoolHomePreviewPage } from './pages/home/SchoolHomePage'
import SchoolHomeManagePage from './pages/home/SchoolHomeManagePage'
import NotificationTemplatesPage from './pages/notifications/NotificationTemplatesPage'
import NotificationHistoryPage from './pages/notifications/NotificationHistoryPage'
import NotificationInboxPage from './pages/notifications/NotificationInboxPage'
import AccountPage from './pages/AccountPage'
import { homeFor, roleOf, LEADERSHIP, SCHOOL_ROLES, type Role } from './roles'
const queryClient = new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15000,refetchOnWindowFocus:false}}})
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.user?.schoolId !== previous.user?.schoolId || JSON.stringify(state.user?.permissions)!==JSON.stringify(previous.user?.permissions)) queryClient.clear()
})
function Protected() {
  const {isAuthenticated,user}=useAuthStore()
  const me=useQuery({queryKey:["effective-session",user?.id],enabled:isAuthenticated&&!!user,refetchInterval:15000,queryFn:async()=>(await client.get("/control/me")).data.data})
  useEffect(()=>{if(me.data)useAuthStore.setState({user:me.data})},[me.data])
  // The School Welcome page and its preview are standalone; every other page, including School Home management, lives inside the workspace shell.
  const here=useLocation().pathname,path=here.length>1&&here.endsWith("/")?here.slice(0,-1):here,welcome=(path==="/home"||path==="/home/preview")&&canVisit(user,path)
  return isAuthenticated && user ? (welcome ? <Outlet /> : <Shell><Outlet /></Shell>) : <Navigate to="/login" replace />
}
// Hides pages from roles that cannot use them. The API refuses those roles independently.
function RoleGate(_props:{allow:Role[]}) {
  const user=useAuthStore(s=>s.user),location=useLocation()
  return canVisit(user,location.pathname) ? <Outlet /> : <ForbiddenPage />
}
function Home() { const user=useAuthStore(s=>s.user);return <Navigate to={homeFor(roleOf(user),user?.dataScope)} replace /> }
export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route element={<Protected />}>
      <Route index element={<Home />} />
      <Route element={<RoleGate allow={[]} />}><Route path="control/*" element={<AccessControlPage/>}/><Route path="super-admin/access-control" element={<AccessControlPage/>}/></Route>
      <Route element={<RoleGate allow={['SuperAdmin']} />}>
        <Route path="super-admin" element={<PlatformDashboard />} />
        <Route path="super-admin/schools" element={<SchoolsPage />} />
        <Route path="super-admin/billing" element={<BillingPage />} />
        <Route path="super-admin/billing/:tab" element={<BillingPage />} />
        <Route path="super-admin/account" element={<AccountPage />} />
      </Route>
      <Route element={<RoleGate allow={['Administrator']} />}>
        <Route path="admin" element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
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
        <Route path="account" element={<AccountPage />} />
        <Route path="home" element={<SchoolHomePage />} />
        <Route path="home/manage" element={<SchoolHomeManagePage />} />
        <Route path="home/preview" element={<SchoolHomePreviewPage />} />
        <Route path="notifications" element={<NotificationInboxPage />} />
        <Route path="notifications/templates" element={<NotificationTemplatesPage />} />
        <Route path="notifications/history" element={<NotificationHistoryPage />} />
        <Route path="student360" element={<Student360Page />} />
        <Route path="student360/:id" element={<Student360Page />} />
        <Route path="suite" element={<SchoolModules />} />
        <Route path="suite/:kind" element={<SuiteRouter />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Route>
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes></BrowserRouter></QueryClientProvider>
}
