// The web notification inbox: the shapes the inbox API returns and where a notification leads. A notification carries
// a destination key, never a path; the app chooses the first permitted page for it. Pure, so it is unit tested.
export type InboxItem = { id: string, type: string, category: string, title: string, body: string, destination: { route: string, entityId?: string } | null, createdAt: string, readAt: string | null }
export type Inbox = { items: InboxItem[], unread: number, totalCount: number, page: number, pageSize: number }

export const CATEGORY_LABELS: Record<string, string> = { attendance: 'Attendance', homework: 'Homework', results: 'Results', fees: 'Fees', notices: 'Notices', leave: 'Leave', timetable: 'Timetable', school: 'School' }
export const categoryLabel = (key: string) => CATEGORY_LABELS[key] ?? 'EduOS'

// Destination keys point at the nearest web page that exists today, most specific first. Only this table changes as pages are added.
const PAGES: Record<string, string[]> = {
  home: ['/'], attendance: ['/suite/register', '/suite/reports'], homework: ['/suite/homework'], results: ['/suite/marks'], fees: ['/suite/fees'],
  notices: ['/suite/communications'], leave: ['/suite/leave-requests'], timetable: ['/suite/timetable'], 'school-home': ['/home'],
}
/**
 * Where a notification opens. The first page the signed-in account may visit is used; an unknown key or no permitted
 * page goes Home. A notice carries its id so the feed can open it; the server authorises the record again.
 */
export function destinationPath(destination: InboxItem['destination'], allowed: (path: string) => boolean): string {
  const candidates = destination ? PAGES[destination.route] : undefined
  const page = candidates?.find(allowed)
  if (!page) return '/'
  return destination?.route === 'notices' && destination.entityId && /^[0-9a-f-]{36}$/i.test(destination.entityId) ? page + '?open=' + destination.entityId : page
}
/** The bell's count: at most "99+", nothing when there is nothing unread. */
export const unreadBadge = (unread: number) => unread <= 0 ? '' : unread > 99 ? '99+' : String(unread)
/** "Just now", "45 min ago", "5 h ago", "3 d ago", then the date. Empty when the time cannot be read. */
export function ago(iso: string, now = new Date()): string {
  const then = new Date(iso); if (Number.isNaN(then.getTime())) return ''
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (minutes < 1) return 'Just now'; if (minutes < 60) return minutes + ' min ago'
  const hours = Math.floor(minutes / 60); if (hours < 24) return hours + ' h ago'
  const days = Math.floor(hours / 24); if (days < 7) return days + ' d ago'
  return then.getDate() + ' ' + MONTHS[then.getMonth()] + ' ' + then.getFullYear()
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
