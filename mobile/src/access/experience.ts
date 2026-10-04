import type { User } from '../session/types.ts'

// What the app shows a person. This is presentation only: every request is authorised again by the gateway and the
// owning service, so a hidden entry is a courtesy and a visible one is not a grant. Nothing here is a second
// permission system; it reads the data scope and permissions EduOS already issued.
export type Experience = 'parent' | 'teacher' | 'student' | 'principal'

/**
 * The experience follows the data scope in the verified account, not the role's display name: schools may rename
 * roles or create their own. A school-wide scope (Administrator, Principal, or a custom leadership role) gets the
 * read-only leadership experience. The platform administrator has no school and is not served by the mobile app.
 */
export function experienceFor(user: Pick<User, 'dataScope'> | null | undefined): Experience | null {
  switch (user?.dataScope) {
    case 'parent': return 'parent'
    case 'teacher': return 'teacher'
    case 'student': return 'student'
    case 'school': return 'principal'
    default: return null
  }
}
export const EXPERIENCE_LABEL: Record<Experience, string> = { parent: 'Parent', teacher: 'Teacher', student: 'Student', principal: 'School leadership' }

export const can = (user: Pick<User, 'permissions'> | null | undefined, permission: string) => !!user?.permissions?.includes(permission)

export type Destination =
  | '/home' | '/profile' | '/welcome' | '/children' | '/classes' | '/timetable' | '/overview'
  | '/homework' | '/results' | '/fees' | '/notices' | '/register' | '/leave' | '/exams' | '/notifications' | '/student360'
export interface NavItem {
  key: string
  label: string
  /** A sentence for the home screen card. */
  summary: string
  icon: string
  /** The permission the backing API requires. The entry is hidden without it. */
  permission?: string
  /** Present when the screen exists in this phase. Entries without one are listed as planned, never as working. */
  route?: Destination
  /** Shown in the bottom bar (at most three per experience, between Home and Profile). */
  tab?: boolean
}

const item = (key: string, label: string, summary: string, icon: string, permission?: string, route?: Destination, tab?: boolean): NavItem =>
  ({ key, label, summary, icon, ...(permission ? { permission } : {}), ...(route ? { route } : {}), ...(tab ? { tab } : {}) })

// Each list is the role's experience, in the order it appears on Home. `tab` marks the (at most three) entries that
// sit in the bottom bar between Home and Profile; everything else is reached from Home or Profile.
export const NAVIGATION: Record<Experience, NavItem[]> = {
  parent: [
    item('children', 'Children', 'Your children and their attendance', 'people-outline', 'reports.view', '/children', true),
    item('homework', 'Homework', 'Assignments and what was handed in', 'book-outline', 'homework.view', '/homework', true),
    item('notices', 'Notices', 'Circulars, events and messages', 'megaphone-outline', 'circulars.view', '/notices', true),
    item('timetable', 'Timetable', 'The weekly lessons', 'time-outline', 'timetable.view', '/timetable'),
    item('results', 'Results', 'Marks and the report card', 'ribbon-outline', 'reports.view', '/results'),
    item('fees', 'Fees', 'Dues and what has been received', 'wallet-outline', 'fees.view', '/fees'),
    item('exams', 'Exams', 'Upcoming and held exams', 'school-outline', 'exams.view', '/exams'),
    item('student360', 'Student 360', 'Everything about each child in one place', 'person-circle-outline', 'reports.view', '/student360'),
  ],
  teacher: [
    item('classes', 'Classes', 'The classes assigned to you', 'easel-outline', 'classes.view', '/classes', true),
    item('attendance', 'Attendance', 'Mark and review the register', 'checkbox-outline', 'attendance.view', '/register', true),
    item('timetable', 'Timetable', 'Your teaching week', 'time-outline', 'timetable.view', '/timetable', true),
    item('homework', 'Homework', 'Work set for your classes', 'book-outline', 'homework.view', '/homework'),
    item('exams', 'Exams', 'Exams for your classes', 'school-outline', 'exams.view', '/exams'),
    item('leave', 'My leave', 'Request leave and see decisions', 'document-text-outline', 'leave-requests.view', '/leave'),
    item('notices', 'Notices', 'Circulars, events and messages', 'megaphone-outline', 'circulars.view', '/notices'),
    item('student360', 'Students', 'Everything about a student in your classes', 'people-outline', 'reports.view', '/student360'),
  ],
  student: [
    item('timetable', 'Timetable', 'Your lessons for the week', 'time-outline', 'timetable.view', '/timetable', true),
    item('homework', 'Homework', 'Assignments and handing in', 'book-outline', 'homework.view', '/homework', true),
    item('results', 'Results', 'Your marks and report card', 'ribbon-outline', 'reports.view', '/results', true),
    item('attendance', 'Attendance', 'Your attendance by month', 'calendar-outline', 'reports.view', '/children'),
    item('exams', 'Exams', 'Upcoming and held exams', 'school-outline', 'exams.view', '/exams'),
    item('fees', 'My fees', 'Instalments, payments and receipts', 'wallet-outline', 'fees.view', '/fees'),
    item('notices', 'Notices', 'Circulars, events and messages', 'megaphone-outline', 'circulars.view', '/notices'),
    item('student360', 'My school profile', 'Attendance, homework, results and more in one place', 'person-circle-outline', 'reports.view', '/student360'),
  ],
  principal: [
    item('overview', 'Overview', 'Enrolment, staff and today’s attendance', 'stats-chart-outline', 'overview.view', '/overview', true),
    item('attendance', 'Attendance', 'Today’s register across the school', 'checkbox-outline', 'attendance.view', '/register', true),
    item('leave', 'Leave', 'Staff leave waiting for a decision', 'document-text-outline', 'leave-requests.view', '/leave', true),
    item('timetable', 'Timetable', 'Today’s cover and the week by class', 'time-outline', 'timetable.view', '/timetable'),
    item('academics', 'Academics', 'Exams across the school', 'school-outline', 'exams.view', '/exams'),
    item('fees', 'Fees', 'Billed, received and outstanding', 'wallet-outline', 'fees.view', '/fees'),
    item('notices', 'Notices', 'Circulars, events and messages', 'megaphone-outline', 'circulars.view', '/notices'),
    item('student360', 'Students', 'Any student of the school, in one place', 'people-outline', 'reports.view', '/student360'),
  ],
}

/** The entries this person may see, in order. Entries whose permission the account lacks are left out. */
export function navigationFor(user: User | null | undefined): NavItem[] {
  const experience = experienceFor(user)
  return experience ? NAVIGATION[experience].filter(entry => !entry.permission || can(user, entry.permission)) : []
}
/** Screens available now, as tabs between Home and Profile. */
export const tabsFor = (user: User | null | undefined) => navigationFor(user).filter(entry => entry.tab && entry.route)
/** True when the person may open this screen. Used by each screen as well as by the tab bar. */
export const canOpen = (user: User | null | undefined, route: Destination) =>
  route === '/home' || route === '/profile' || route === '/welcome' || route === '/notifications' ? !!experienceFor(user) : navigationFor(user).some(entry => entry.route === route)
