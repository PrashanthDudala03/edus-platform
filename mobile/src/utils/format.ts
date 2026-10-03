// Small pure helpers shared by screens. No dates or numbers are invented here; they only format what EduOS returned.
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

const pad = (n: number) => String(n).padStart(2, '0')
/** yyyy-MM-dd in the device's own time zone, the form the EduOS APIs expect for a day. */
export const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
/** yyyy-MM, for monthly reports. */
export const isoMonth = (date: Date) => isoDay(date).slice(0, 7)
/** Monday-first weekday name for a date. */
export const weekdayOf = (date: Date): Weekday => WEEKDAYS[(date.getDay() + 6) % 7]
export const greeting = (hour: number) => hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
/** The first letters of a name, for an avatar where there is no photograph. */
export const initials = (name: string, most = 2) => String(name ?? '').split(/\s+/).filter(word => /^[\p{L}\p{N}]/u.test(word)).slice(0, most).map(word => word[0].toUpperCase()).join('')
/** Whole numbers get separators; anything a school typed itself (for example "25+") is shown as written. */
export const figure = (value: unknown) => /^\d+(\.\d+)?$/.test(String(value)) ? Number(value).toLocaleString('en-IN') : String(value ?? '')
export const percent = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 100) : null

export interface Lesson { id: string, day: string, startsAt: string, endsAt: string, classId: string, subjectId: string, teacherId: string, room: string }
/** Groups timetable records by weekday, Monday first, each day in time order. Days without lessons are left out. */
export function lessonsByDay(lessons: Lesson[]): { day: Weekday, lessons: Lesson[] }[] {
  return WEEKDAYS.map(day => ({ day, lessons: lessons.filter(lesson => lesson.day === day).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) })).filter(group => group.lessons.length > 0)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Parts of a yyyy-MM-dd day, formatted without relying on the device's locale data. */
export function dayParts(day: string): { day: string, month: string, year: string, label: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '')
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null
  const parts = { day: String(Number(match[3])), month: MONTHS[Number(match[2]) - 1], year: match[1] }
  return { ...parts, label: `${parts.day} ${parts.month} ${parts.year}` }
}
/** "14 Nov 2026" or "14 Nov 2026 – 16 Nov 2026". */
export function dayRange(startsOn: string, endsOn: string) {
  const start = dayParts(startsOn)?.label ?? '', end = dayParts(endsOn)?.label ?? ''
  return !end || end === start ? start : `${start} – ${end}`
}

/** How long ago something happened, in words short enough for a list row. Older than a week shows the date. */
export function ago(iso: string, now: Date): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const minutes = Math.floor((now.getTime() - then) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))} d ago`
  return dayParts(iso)?.label ?? ''
}
