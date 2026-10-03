// The shapes EduOS returns for the core modules and the small rules the screens share. Pure functions only, so they
// are tested without a device. Nothing here computes a figure the server did not supply the parts for.
export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Excused'
export const STATUSES: AttendanceStatus[] = ['Present', 'Late', 'Absent', 'Excused']

export interface Child { studentId: string, name: string, className: string, classId: string, admissionNumber: string, present: number, absent: number, late: number, excused: number, markedDays: number }
export interface Homework { id: string, title: string, classId: string, subjectId: string, dueDate: string, instructions: string }
export type HomeworkGroup = 'due-today' | 'upcoming' | 'submitted' | 'reviewed' | 'late' | 'missing' | 'excused' | 'closed'
export const HOMEWORK_GROUPS: HomeworkGroup[] = ['due-today', 'upcoming', 'missing', 'late', 'submitted', 'reviewed', 'excused', 'closed']
export const GROUP_LABEL: Record<HomeworkGroup, string> = { 'due-today': 'Due today', upcoming: 'Upcoming', submitted: 'Completed', reviewed: 'Reviewed', late: 'Completed late', missing: 'Missing', excused: 'Excused', closed: 'Closed' }
/** How work comes back: information only, a tap to confirm, a written answer, files (web upload), or shown in class. */
export type SubmissionMode = 'None' | 'Done' | 'Text' | 'File' | 'Physical'
export const MODE_LABEL: Record<SubmissionMode, string> = { None: 'No online submission', Done: 'Mark as done', Text: 'Text response', File: 'Online file submission', Physical: 'Shown in class' }
export type Outcome = '' | 'Completed' | 'Late' | 'Missing' | 'Excused'
export const OUTCOMES: Exclude<Outcome, ''>[] = ['Completed', 'Late', 'Missing', 'Excused']
export interface HomeworkSubmission { id: string, version: number, status: 'Submitted' | 'Reviewed' | '', submittedAt: string, late: boolean, outcome: Outcome, response: string, grade: string, feedback: string, resubmissions: number, attachments: number }
export interface Assignment { id: string, title: string, className: string, subjectName: string, teacher: string, instructions: string, dueDate: string, dueTime: string, maxMarks: string, submissionMode: SubmissionMode, status: 'Draft' | 'Published' | 'Closed', attachments: number }
export const studentSubmits = (mode: SubmissionMode) => mode === 'Done' || mode === 'Text' || mode === 'File'
export const tracked = (mode: SubmissionMode) => mode !== 'None'
export interface BoardItem extends Assignment { group: HomeworkGroup, submission: HomeworkSubmission | null }
export interface OverviewItem extends Assignment { assigned: number, submitted: number, late: number, reviewed: number, pending: number, missing: number }
export interface ReviewRow { studentId: string, name: string, code: string, group: HomeworkGroup, submission: HomeworkSubmission | null }
/** Groups that still need something from the student, soonest first. */
export const needsAttention = (items: BoardItem[]) => items.filter(i => i.group === 'due-today' || i.group === 'upcoming' || i.group === 'missing').sort((a, b) => (a.dueDate + a.dueTime).localeCompare(b.dueDate + b.dueTime))
export const groupTone = (group: HomeworkGroup): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' => group === 'missing' ? 'danger' : group === 'late' ? 'warning' : group === 'reviewed' || group === 'submitted' ? 'success' : group === 'due-today' ? 'primary' : 'neutral'
export const marksLabel = (submission: HomeworkSubmission | null, maxMarks: string) => submission?.grade ? submission.grade + (maxMarks ? ' / ' + maxMarks : '') : ''
/** A student may hand in (again) while the work is published, is done online and is not yet reviewed or excused. */
export const mayHandIn = (item: BoardItem) => item.status === 'Published' && studentSubmits(item.submissionMode) && item.submission?.status !== 'Reviewed' && item.submission?.outcome !== 'Excused'
/** What the student does with this assignment, in their words. */
export const handInLabel = (item: BoardItem) => item.submissionMode === 'Done' ? (item.submission ? 'Marked as done' : 'Mark as done') : item.submission ? 'Hand in again' : 'Hand in'
export const overviewTotals = (items: OverviewItem[]) => ({ toReview: items.reduce((n, i) => n + i.pending, 0), missing: items.reduce((n, i) => n + i.missing, 0), late: items.reduce((n, i) => n + i.late, 0), published: items.filter(i => i.status === 'Published').length })
export interface Submission { id: string, homeworkId: string, studentId: string, response: string, feedback: string, grade: string }
export interface Exam { id: string, name: string, classId: string, subjectId: string, date: string, maxMarks: string, passMarks: string, status: string }
export interface Circular { id: string, title: string, message: string, audience: string, classId: string, dueDate: string, createdAt: string }
export interface CalendarEvent { id: string, title: string, startsOn: string, endsOn: string, description: string }
export interface Message { id: string, title: string, message: string, createdAt: string }
export interface Leave { id: string, version: number, teacherId: string, fromDate: string, toDate: string, reason: string, status: string, approvalRemark: string }
export interface Charge { id: string, studentId: string, student: string, description: string, dueDate: string, gross: number, concession: number, paid: number, balance: number, currency: string }
export interface RegisterRow { id: string, code: string, name: string, className: string, status: AttendanceStatus | '', reason?: string, remark?: string }
/** Structured reasons the school can record with Absent, Late or Excused. The list itself comes from the server; this is the fallback. */
export const REASONS = ['Sick', 'Approved leave', 'Transport delay', 'Medical', 'School activity', 'Family', 'Other']
export interface Reason { reason: string, remark: string }
export interface ClassRegister { className: string, expected: number, marked: number, present: number, absent: number, late: number, excused: number, state: string, teacher: string, submittedAt: string }
export interface RegisterTotals { expected: number, marked: number, present: number, absent: number, late: number, excused: number, completed: number, pending: number, percent: number }
export interface DayRecord { day: string, status: AttendanceStatus, reason: string, remark: string }
export interface ReportCard { results: { exam: string, subject: string, score: number, maximum: number, pass: boolean, remarks: string }[], obtained: number, maximum: number, percent: number, grade: string }

const day = (value: string) => String(value ?? '').slice(0, 10)

/** Homework split around today: what is still due (soonest first) and what has passed (most recent first). */
export function splitHomework<T extends { dueDate: string }>(items: T[], today: string): { upcoming: T[], past: T[] } {
  const sorted = [...items].sort((a, b) => day(a.dueDate).localeCompare(day(b.dueDate)))
  return { upcoming: sorted.filter(item => day(item.dueDate) >= today), past: sorted.filter(item => day(item.dueDate) < today).reverse() }
}
/** Events that have not ended yet, soonest first. */
export function upcomingEvents<T extends { startsOn: string, endsOn: string }>(events: T[], today: string): T[] {
  return events.filter(event => day(event.endsOn || event.startsOn) >= today).sort((a, b) => day(a.startsOn).localeCompare(day(b.startsOn)))
}
export const newestFirst = <T extends { createdAt: string }>(items: T[]) => [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

/** Totals exactly as the web fee summary computes them: billed is after concessions. */
export function feeTotals(charges: Charge[]) {
  const sum = (pick: (charge: Charge) => number) => charges.reduce((total, charge) => total + (Number(pick(charge)) || 0), 0)
  return { billed: sum(c => c.gross - c.concession), paid: sum(c => c.paid), balance: sum(c => c.balance), outstanding: charges.filter(c => c.balance > 0).length, count: charges.length, currency: charges[0]?.currency ?? '' }
}
export const money = (currency: string, value: number) => `${currency ? currency + ' ' : ''}${(Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The register as it will look once the unsaved choices are applied. */
export function registerSummary(rows: RegisterRow[], draft: Record<string, AttendanceStatus> = {}) {
  const counts = { Present: 0, Late: 0, Absent: 0, Excused: 0, unmarked: 0, total: rows.length }
  for (const row of rows) { const status = draft[row.id] ?? row.status; if (status) counts[status]++; else counts.unmarked++ }
  return counts
}
/** Only the entries that differ from what is saved are sent. */
export function registerChanges(rows: RegisterRow[], draft: Record<string, AttendanceStatus>): { studentId: string, status: AttendanceStatus }[] {
  return rows.filter(row => draft[row.id] && draft[row.id] !== row.status).map(row => ({ studentId: row.id, status: draft[row.id] }))
}
/** Every student without a saved or chosen status becomes Present; choices already made are kept. */
export function markRestPresent(rows: RegisterRow[], draft: Record<string, AttendanceStatus>): Record<string, AttendanceStatus> {
  const next = { ...draft }
  for (const row of rows) if (!row.status && !next[row.id]) next[row.id] = 'Present'
  return next
}
/** A reason can accompany Absent, Late or Excused; Present never carries one. */
export const mayHaveReason = (status: AttendanceStatus | '') => status === 'Absent' || status === 'Late' || status === 'Excused'
/** What is sent: every changed status, with the reason chosen for it (or the saved one) when the status can carry one. */
export function registerEntries(rows: RegisterRow[], draft: Record<string, AttendanceStatus>, reasons: Record<string, Reason> = {}) {
  return rows.flatMap(row => {
    const status = draft[row.id]; if (!status) return []
    const chosen = reasons[row.id], reason = mayHaveReason(status) ? (chosen?.reason ?? row.reason ?? '') : '', remark = mayHaveReason(status) ? (chosen?.remark ?? row.remark ?? '') : ''
    if (status === row.status && reason === (row.reason ?? '') && remark === (row.remark ?? '')) return []
    return [{ studentId: row.id, status, reason, remark }]
  })
}
/** Classes whose register was submitted: the next change to them is a correction and needs a reason. */
export const submittedClasses = (registers: ClassRegister[]) => new Set(registers.filter(r => r.state === 'Submitted' || r.state === 'Corrected').map(r => r.className))
export const isCorrection = (rows: RegisterRow[], draft: Record<string, AttendanceStatus>, submitted: Set<string>) => registerEntries(rows, draft).some(e => submitted.has(rows.find(r => r.id === e.studentId)?.className ?? ''))
export const registerDone = (state: string) => state === 'Submitted' || state === 'Corrected'
export const classesOf = (rows: RegisterRow[]) => [...new Set(rows.map(row => row.className).filter(Boolean))].sort()

/** Inclusive number of days in a leave request, or 0 when the dates are not usable. */
export function leaveDays(fromDate: string, toDate: string) {
  const from = Date.parse(day(fromDate) + 'T00:00:00Z'), to = Date.parse(day(toDate) + 'T00:00:00Z')
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? Math.round((to - from) / 86_400_000) + 1 : 0
}
/** yyyy-MM-dd moved by a number of days. */
export function shiftDay(value: string, by: number) {
  const date = new Date(day(value) + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + by)
  return date.toISOString().slice(0, 10)
}
/** The last `count` days ending today, oldest first, for a horizontal day picker. */
export const recentDays = (today: string, count: number) => Array.from({ length: count }, (_, i) => shiftDay(today, i - count + 1))
