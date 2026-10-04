// Timetable 2.0 on the phone: the shapes the timetable endpoints return and the pure logic the screens use, kept
// free of React so it is tested with node:test. Figures come from the server; this only arranges them.
export interface Slot { id: string, name: string, order: number, startsAt: string, endsAt: string, type: string }
export interface Substitution { id: string, teacherId: string, teacherName: string, note: string, version: number }
export interface Period {
  id: string, day: string, startsAt: string, endsAt: string, slotId: string, room: string, classId: string, className: string, subjectId: string, subjectName: string, teacherId: string, teacherName: string,
  date?: string, substituted?: boolean, effectiveTeacherName?: string, away?: boolean, status?: 'covered' | 'uncovered' | 'scheduled', substitution?: Substitution, covering?: boolean, originalTeacherName?: string,
}
export interface TimetableDay { date: string, day: string, classId?: string, className?: string, away?: boolean, slots: Slot[], periods: Period[] }
export interface TimetableWeek { from: string, to: string, days: { day: string, date: string }[], slots: Slot[], periods: Period[], office: boolean }
export interface AwayTeacher { teacherId: string, teacherName: string, leaveId: string, type: string, halfDay: string, fromDate: string, toDate: string, source: 'leave' | 'register' }
export interface Operations { date: string, day: string, away: AwayTeacher[], periods: Period[], summary: { away: number, affected: number, covered: number, uncovered: number } }
export interface Candidate { teacherId: string, name: string, free: boolean, reason: string, teachesSubject: boolean, teachesClass: boolean, load: number }
/** One row of a day: a period of the school's structure (or a lesson at its own time) with the lessons in it. */
export interface DayRow { key: string, name: string, startsAt: string, endsAt: string, type: string, periods: Period[] }

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const minutesOf = (hhmm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : -1 }
/** The rows of one day: the structure's periods in order, lessons placed in theirs, other times as their own rows. */
export function dayRows(slots: Slot[], periods: Period[]): DayRow[] {
  const rows = new Map<string, DayRow>()
  for (const s of [...slots].sort((a, b) => a.order - b.order || minutesOf(a.startsAt) - minutesOf(b.startsAt))) rows.set(s.startsAt + '-' + s.endsAt, { key: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, type: s.type, periods: [] })
  for (const p of periods) {
    const k = p.startsAt + '-' + p.endsAt
    if (!rows.has(k)) rows.set(k, { key: k, name: '', startsAt: p.startsAt, endsAt: p.endsAt, type: 'Teaching', periods: [] })
    rows.get(k)!.periods.push(p)
  }
  return [...rows.values()].sort((a, b) => minutesOf(a.startsAt) - minutesOf(b.startsAt))
}
/** Rows worth showing: lessons, and the breaks between them; a day with no lessons is empty. */
export const shownRows = (rows: DayRow[]) => rows.some(r => r.periods.length) ? rows.filter(r => r.type !== 'Teaching' || r.periods.length) : []
/** Where the day stands: the index of the row in progress (or -1) and of the next row (or -1). */
export function positionOf(rows: { startsAt: string, endsAt: string }[], now: number): { current: number, next: number } {
  for (let i = 0; i < rows.length; i++) {
    if (minutesOf(rows[i]!.startsAt) <= now && now < minutesOf(rows[i]!.endsAt)) return { current: i, next: i + 1 < rows.length ? i + 1 : -1 }
    if (minutesOf(rows[i]!.startsAt) > now) return { current: -1, next: i }
  }
  return { current: -1, next: -1 }
}
/** The next lesson from a moment: the first teaching row that starts later, or the one in progress. */
export const nextLesson = (rows: DayRow[], now: number) => { const lessons = rows.filter(r => r.periods.length); const { current, next } = positionOf(lessons, now); return current >= 0 ? lessons[current] : next >= 0 ? lessons[next] : undefined }
export const teacherShown = (p: Period) => p.effectiveTeacherName || p.teacherName
/** The words under a period for the person reading it. */
export const periodNote = (p: Period, showClass: boolean) => [showClass ? p.className : teacherShown(p), p.room ? 'Room ' + p.room : '', p.covering ? 'Covering for ' + (p.originalTeacherName ?? '') : p.status === 'covered' ? 'Covered by ' + (p.substitution?.teacherName ?? teacherShown(p)) : p.status === 'uncovered' ? 'Needs cover' : p.substituted ? 'Substitute' : ''].filter(Boolean).join(' · ')
export const periodTone = (p: Period) => p.status === 'uncovered' ? 'warning' as const : p.covering || p.status === 'covered' || p.substituted ? 'primary' as const : 'neutral' as const
export const dateOf = (iso: string, by = 0) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10) }
/** Monday of the week that holds a date. */
export const weekStart = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return dateOf(iso, -((d.getUTCDay() + 6) % 7)) }
export const weekdayOfDate = (iso: string) => WEEKDAYS[(new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7]!
export const impactWord = (s: { affected: number, covered: number, uncovered: number }) => s.affected === 0 ? 'No lessons affected' : s.uncovered === 0 ? s.affected + ' lesson' + (s.affected === 1 ? '' : 's') + ', all covered' : s.uncovered + ' of ' + s.affected + ' lesson' + (s.affected === 1 ? '' : 's') + ' need cover'
