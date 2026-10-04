import { LayoutDashboard, GraduationCap, Users, BookOpen, CalendarCheck, Megaphone, ShieldCheck, Settings, Layers, Building2, Bell, History, Wallet, FileText, ClipboardList, CreditCard, School, type LucideIcon } from 'lucide-react'
import type { User } from './store/auth'

// Presentation only. Every API call is authorized again by the gateway and the owning service.
export type Role = string
export const SCHOOL_ROLES: Role[] = ['Administrator', 'Principal', 'Teacher', 'Parent', 'Student']
export const LEADERSHIP: Role[] = ['Administrator', 'Principal']

export const roleOf = (user: User | null | undefined): Role | '' => (user?.roles?.[0] as Role) || ''
export const isAdministrator = (role: string | undefined) => role === 'Administrator'
export const isLeadership = (role: string | undefined) => role === 'Administrator' || role === 'Principal'

const homes: Record<Role, string> = {
  SuperAdmin: '/super-admin', Administrator: '/admin', Principal: '/principal',
  Teacher: '/teacher', Parent: '/parent', Student: '/student',
}
export const homeFor = (role: string, scope?: string) => scope==='platform'?'/super-admin':homes[role as Role] || '/suite'

export const portalName: Record<Role, string> = {
  SuperAdmin: 'Super Admin portal', Administrator: 'Administrator portal', Principal: 'Principal portal',
  Teacher: 'Teacher portal', Parent: 'Parent portal', Student: 'Student Portal',
}

export type NavLink = readonly [path: string, label: string, icon: LucideIcon]
export type NavSection = { title: string, links: NavLink[] }

// Each entry points at a page whose backend endpoints accept this role.
export const navigation: Record<Role, NavSection[]> = {
  SuperAdmin: [
    { title: 'Platform', links: [['/super-admin', 'Dashboard', LayoutDashboard], ['/super-admin/schools', 'Schools', Building2], ['/super-admin/billing', 'Billing & subscriptions', CreditCard]] },
  ],
  Administrator: [
    { title: 'Overview', links: [['/admin', 'Dashboard', LayoutDashboard], ['/home', 'School Home', School], ['/suite', 'All school modules', Layers]] },
    { title: 'School & users', links: [['/settings', 'School settings & accounts', Settings], ['/suite/school-config', 'Branding & print settings', Settings], ['/home/manage', 'School Home management', School], ['/subscription', 'Subscription & billing', CreditCard], ['/suite/account-links', 'Account profile links', Users], ['/suite/academic-years', 'Academic years', BookOpen], ['/suite/classes', 'Classes & sections', BookOpen], ['/suite/subjects', 'Subjects', BookOpen]] },
    { title: 'People', links: [['/students', 'Student records', GraduationCap], ['/student360', 'Student 360', GraduationCap], ['/teachers', 'Teacher profiles', Users], ['/parents', 'Parents & guardians', Users]] },
    { title: 'Notifications', links: [['/notifications/templates', 'Notification wording', Bell], ['/notifications/history', 'Delivery history', History]] },
    { title: 'Academics', links: [['/suite/admissions', 'Admissions', GraduationCap], ['/suite/allocation', 'Class allocation & promotion', GraduationCap], ['/suite/teaching-assignments', 'Teaching assignments', Users], ['/suite/timetable', 'Weekly timetable', CalendarCheck], ['/suite/exams', 'Exams & schedules', ClipboardList], ['/suite/marks', 'Marks & remarks', ClipboardList], ['/suite/homework', 'Homework & assignments', BookOpen], ['/suite/submissions', 'Submissions & feedback', BookOpen]] },
    { title: 'Attendance', links: [['/attendance', 'Daily register', CalendarCheck], ['/suite/register', 'Student attendance', CalendarCheck], ['/suite/staff-attendance', 'Staff attendance', CalendarCheck], ['/suite/leave-requests', 'Leave approvals', CalendarCheck]] },
    { title: 'Finance', links: [['/suite/fees', 'Fees & receipts', Wallet], ['/suite/fee-structures', 'Fee structures', Wallet]] },
    { title: 'Communication', links: [['/suite/circulars', 'Circulars & acknowledgements', Megaphone], ['/announcements', 'Admin noticeboard', Megaphone], ['/suite/messages', 'Targeted messages', Megaphone], ['/suite/calendar', 'School calendar', CalendarCheck]] },
    { title: 'Documents & reports', links: [['/suite/certificates', 'Certificates & ID cards', FileText], ['/suite/reports', 'Reports & Excel imports', ShieldCheck], ['/audit', 'Activity log', ShieldCheck]] },
  ],
  Principal: [
    { title: 'Overview', links: [['/principal', 'Dashboard', LayoutDashboard], ['/home', 'School Home', School]] },
    { title: 'People', links: [['/students', 'Students', GraduationCap], ['/student360', 'Student 360', GraduationCap], ['/teachers', 'Teachers', Users], ['/parents', 'Parents & guardians', Users]] },
    { title: 'Academics', links: [['/suite/classes', 'Classes & sections', BookOpen], ['/suite/timetable', 'Timetable', CalendarCheck], ['/suite/teaching-assignments', 'Teaching assignments', Users], ['/suite/homework', 'Homework', BookOpen]] },
    { title: 'Attendance', links: [['/attendance', 'Student attendance', CalendarCheck], ['/suite/staff-attendance', 'Staff attendance', CalendarCheck], ['/suite/leave-requests', 'Leave approvals', CalendarCheck]] },
    { title: 'Exams & results', links: [['/suite/exams', 'Exams', ClipboardList], ['/suite/marks', 'Marks & results', ClipboardList], ['/suite/reports', 'Reports & report cards', ShieldCheck]] },
    { title: 'Communication', links: [['/suite/circulars', 'Circulars', Megaphone], ['/announcements', 'Noticeboard', Megaphone], ['/suite/messages', 'Messages', Megaphone], ['/suite/calendar', 'School calendar', CalendarCheck]] },
    { title: 'Records', links: [['/suite/certificates', 'Certificates', FileText], ['/suite/fees', 'Fees (view only)', Wallet], ['/audit', 'Activity log', ShieldCheck]] },
  ],
  Teacher: [
    { title: 'Overview', links: [['/teacher', 'Dashboard', LayoutDashboard], ['/home', 'School Home', School], ['/suite/classes', 'My classes', BookOpen], ['/suite/timetable', 'Timetable', CalendarCheck]] },
    { title: 'Teaching', links: [['/student360', 'Student 360', GraduationCap], ['/suite/register', 'Attendance', CalendarCheck], ['/suite/homework', 'Homework', BookOpen], ['/suite/submissions', 'Submissions & feedback', BookOpen], ['/suite/exams', 'Exams', ClipboardList], ['/suite/marks', 'Marks', ClipboardList], ['/suite/reports', 'Reports', ShieldCheck]] },
    { title: 'Notices', links: [['/suite/circulars', 'Circulars', Megaphone], ['/suite/messages', 'Messages', Megaphone], ['/suite/calendar', 'School calendar', CalendarCheck], ['/suite/leave-requests', 'My leave', CalendarCheck]] },
  ],
  Parent: [
    { title: 'My children', links: [['/parent', 'Dashboard', LayoutDashboard], ['/student360', 'Student 360', GraduationCap], ['/home', 'School Home', School], ['/suite/timetable', 'Timetable', CalendarCheck], ['/suite/homework', 'Homework', BookOpen], ['/suite/submissions', 'Submissions', BookOpen]] },
    { title: 'Progress', links: [['/suite/exams', 'Exams', ClipboardList], ['/suite/marks', 'Results', ClipboardList], ['/suite/reports', 'Attendance & report cards', ShieldCheck]] },
    { title: 'Family', links: [['/suite/fees', 'Fees & receipts', Wallet], ['/suite/circulars', 'Circulars', Megaphone], ['/suite/messages', 'Messages', Megaphone], ['/suite/calendar', 'School calendar', CalendarCheck], ['/suite/certificates', 'Documents & certificates', FileText]] },
  ],
  Student: [
    { title: 'My day', links: [['/student', 'Dashboard', LayoutDashboard], ['/student360', 'My school profile', GraduationCap], ['/home', 'School Home', School], ['/suite/timetable', 'Timetable', CalendarCheck], ['/suite/homework', 'Homework', BookOpen], ['/suite/submissions', 'My submissions', BookOpen]] },
    { title: 'Progress', links: [['/suite/exams', 'Exams', ClipboardList], ['/suite/marks', 'My results', ClipboardList], ['/suite/reports', 'Attendance & report card', ShieldCheck]] },
    { title: 'School', links: [['/suite/circulars', 'Notices & circulars', Megaphone], ['/suite/messages', 'Messages', Megaphone], ['/suite/calendar', 'School calendar', CalendarCheck], ['/suite/certificates', 'Documents & certificates', FileText]] },
  ],
}
