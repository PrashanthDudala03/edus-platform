// Timetable 2.0 presentation helpers, kept free of React so they are unit tested: the day grid built from the
// school's period structure and its lessons, where a day stands right now, and the words for a period's state.
export type Slot = { id: string, name: string, order: number, startsAt: string, endsAt: string, type: string }
export type Substitution = { id: string, teacherId: string, teacherName: string, note: string, version: number }
export type Period = {
  id: string, day: string, startsAt: string, endsAt: string, slotId: string, room: string, yearId: string,
  classId: string, className: string, subjectId: string, subjectName: string, teacherId: string, teacherName: string, version?: number,
  date?: string, substituted?: boolean, effectiveTeacherId?: string, effectiveTeacherName?: string,
  away?: boolean, status?: 'covered' | 'uncovered' | 'scheduled', substitution?: Substitution, covering?: boolean, originalTeacherName?: string,
}
export type Week = { from: string, to: string, days: { day: string, date: string }[], slots: Slot[], periods: Period[], office: boolean, filter: { classId: string, teacherId: string, room: string }, classes: { id: string, name: string }[] }
export type Day = { date: string, day: string, classId?: string, className?: string, away?: boolean, slots: Slot[], periods: Period[] }
export type Away = { teacherId: string, teacherName: string, leaveId: string, type: string, halfDay: string, fromDate: string, toDate: string, source: 'leave' | 'register' }
export type Operations = { date: string, day: string, away: Away[], periods: Period[], summary: { away: number, affected: number, covered: number, uncovered: number } }
export type Candidate = { teacherId: string, name: string, free: boolean, reason: string, teachesSubject: boolean, teachesClass: boolean, load: number }
export type GridRow = { key: string, name: string, startsAt: string, endsAt: string, type: string, cells: Record<string, Period[]> }

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const minutes = (hhmm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : -1 }
export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes()
export const dayName = (date = new Date()) => DAYS[(date.getDay() + 6) % 7]
export const isoDate = (d = new Date()) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
export const shiftDate = (iso: string, days: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDate(d) }
export const span = (p: { startsAt: string, endsAt: string }) => p.startsAt + '–' + p.endsAt

/** The rows of a day or week: the school's periods in order, with lessons placed in the period they fill; a lesson at other times gets its own row. */
export function gridRows(slots: Slot[], periods: Period[]): GridRow[] {
  const rows = new Map<string, GridRow>()
  for (const s of [...slots].sort((a, b) => a.order - b.order || minutes(a.startsAt) - minutes(b.startsAt))) rows.set(s.startsAt + '-' + s.endsAt, { key: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, type: s.type, cells: {} })
  for (const p of periods) {
    const k = p.startsAt + '-' + p.endsAt
    if (!rows.has(k)) rows.set(k, { key: k, name: '', startsAt: p.startsAt, endsAt: p.endsAt, type: 'Teaching', cells: {} })
    const row = rows.get(k)!; row.cells[p.day] = [...(row.cells[p.day] ?? []), p].sort((a, b) => a.className.localeCompare(b.className))
  }
  return [...rows.values()].sort((a, b) => minutes(a.startsAt) - minutes(b.startsAt))
}
/** Monday to Friday always; Saturday and Sunday only when something is on them. */
export const daysShown = (rows: GridRow[]) => DAYS.filter((d, i) => i < 5 || rows.some(r => r.cells[d]?.length))
/** Where the day stands: the row in progress (or -1) and the next teaching row (or -1). */
export function position(rows: { startsAt: string, endsAt: string }[], now: number): { current: number, next: number } {
  for (let i = 0; i < rows.length; i++) {
    if (minutes(rows[i]!.startsAt) <= now && now < minutes(rows[i]!.endsAt)) return { current: i, next: i + 1 < rows.length ? i + 1 : -1 }
    if (minutes(rows[i]!.startsAt) > now) return { current: -1, next: i }
  }
  return { current: -1, next: -1 }
}
/** The teacher a reader sees for a period on a date: the substitute when one covers it. */
export const teacherShown = (p: Period) => p.effectiveTeacherName || p.teacherName
export const statusWord = (p: Period) => p.status === 'covered' ? 'Covered by ' + (p.substitution?.teacherName ?? teacherShown(p)) : p.status === 'uncovered' ? 'Needs cover' : p.covering ? 'Covering for ' + (p.originalTeacherName ?? '') : ''
export const statusTone = (p: Period) => p.status === 'uncovered' ? 'important' : p.status === 'covered' || p.covering ? 'active' : ''
/** The next weekday that has a timetable, for the date pickers' default. */
export const nextSchoolDay = (iso: string, rows: GridRow[]) => { for (let i = 0; i < 7; i++) { const d = shiftDate(iso, i); if (daysShown(rows).includes(dayName(new Date(d + 'T00:00:00')))) return d } return iso }
